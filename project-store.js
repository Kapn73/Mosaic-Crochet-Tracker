(() => {
  "use strict";

  const DB_NAME = "MosaicCrochetProjectViewerPublic";
  const DB_VERSION = 2;
  const PROJECT_STORE = "projects";
  const PROGRESS_STORE = "progress";
  const SETTINGS_STORE = "settings";

  const FALLBACK_PROJECTS = "mosaic-crochet-public-projects:v1";
  const FALLBACK_SETTINGS = "mosaic-crochet-public-settings:v1";

  const DEFAULT_SEGMENT_SIZE = 10;
  const MAX_CHART_CELLS = 200000;
  const MAX_JSON_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_BACKUP_FILE_BYTES = 100 * 1024 * 1024;
  const MAX_PROJECT_NAME_LENGTH = 100;
  const MAX_TITLE_LENGTH = 160;
  const MAX_PALETTE_NAME_LENGTH = 80;
  const MAX_SOURCE_FILE_NAME_LENGTH = 255;
  const MAX_PROJECT_NOTES_LENGTH = 5000;
  const MAX_ROW_NOTE_LENGTH = 1200;
  const MAX_DETAIL_LENGTH = 240;
  const VALID_STITCH_CODES = new Set(["s", "d", "b", "c"]);
  const HEX_COLOR = /^#[0-9A-F]{6}$/i;
  const SAFE_PALETTE_KEY = /^[0-9A-Za-z]$/;

  const BACKUP_TYPE = "mosaic-crochet-project-library";
  const PROJECT_BACKUP_TYPE = "mosaic-crochet-project";
  const BACKUP_SCHEMA_VERSION = 2;
  const APP_DATA_VERSION = 4;
  const AUTO_BACKUP_DELAY = 1200;

  const AUTO_BACKUP_ENABLED_KEY = "autoBackupEnabled";
  const AUTO_BACKUP_HANDLE_KEY = "autoBackupFileHandle";
  const AUTO_BACKUP_FILE_NAME_KEY = "autoBackupFileName";
  const AUTO_BACKUP_LAST_SAVED_KEY = "autoBackupLastSavedAt";
  const PRE_RESTORE_RECOVERY_KEY = "preRestoreRecovery";
  const RECOVERY_PREFIX = "mosaic-crochet-progress-recovery:";

  let db = null;
  let mode = "indexeddb";

  let autoBackupHandle = null;
  let autoBackupEnabled = false;
  let autoBackupTimer = null;
  let suppressAutoBackup = 0;
  const backupListeners = new Set();

  let backupState = {
    supported: false,
    enabled: false,
    hasHandle: false,
    persistentHandle: false,
    fileName: "",
    permission: "unknown",
    pending: false,
    saving: false,
    lastSavedAt: null,
    error: ""
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function cleanText(value, maximum, fallback = "") {
    const cleaned = String(value ?? fallback)
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return (cleaned || fallback).slice(0, maximum);
  }

  function normalizeProjectName(value, fallback = "Untitled project") {
    return cleanText(value, MAX_PROJECT_NAME_LENGTH, fallback);
  }
  function cleanMultilineText(value, maximum) {
    return String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .trim()
      .slice(0, maximum);
  }


  function slugify(value) {
    return cleanText(value, 120, "mosaic-chart")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "mosaic-chart";
  }

  function rgbFromHex(hex) {
    return [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16)
    ];
  }

  function normalizeSource(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};

    const normalized = {};
    for (const [key, value] of Object.entries(source).slice(0, 30)) {
      const safeKey = cleanText(key, 60);
      if (!safeKey) continue;

      if (typeof value === "string") {
        normalized[safeKey] = cleanText(value, 1000);
      } else if (typeof value === "number" && Number.isFinite(value)) {
        normalized[safeKey] = value;
      } else if (typeof value === "boolean") {
        normalized[safeKey] = value;
      }
    }

    return normalized;
  }

  function normalizeProjectDetails(details) {
    const source = details && typeof details === "object" && !Array.isArray(details)
      ? details
      : {};

    return {
      yarnBrand: cleanText(source.yarnBrand, MAX_DETAIL_LENGTH),
      hookSize: cleanText(source.hookSize, MAX_DETAIL_LENGTH),
      gauge: cleanText(source.gauge, MAX_DETAIL_LENGTH),
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(source.startDate || ""))
        ? String(source.startDate)
        : ""
    };
  }

  function normalizeRowNotes(rowNotes, chart) {
    const normalized = {};
    if (!rowNotes || typeof rowNotes !== "object" || Array.isArray(rowNotes)) {
      return normalized;
    }

    for (const [key, value] of Object.entries(rowNotes)) {
      const row = Number(key);
      if (!Number.isInteger(row) || row < 1 || row > chart.dimensions.rows) continue;
      const note = cleanMultilineText(value, MAX_ROW_NOTE_LENGTH);
      if (note) normalized[String(row)] = note;
    }

    return normalized;
  }

  function validateChart(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("The file does not contain a chart object.");
    }

    const rows = Number(data.dimensions?.rows);
    const stitches = Number(data.dimensions?.stitchesPerRow);

    if (!Number.isInteger(rows) || rows < 1) {
      throw new Error("The chart needs a valid dimensions.rows value.");
    }

    if (!Number.isInteger(stitches) || stitches < 1) {
      throw new Error("The chart needs a valid dimensions.stitchesPerRow value.");
    }

    const totalCells = rows * stitches;
    if (!Number.isSafeInteger(totalCells) || totalCells > MAX_CHART_CELLS) {
      throw new Error(
        `The chart contains ${Number.isFinite(totalCells) ? totalCells.toLocaleString() : "too many"} cells. ` +
        `The current safety limit is ${MAX_CHART_CELLS.toLocaleString()} cells.`
      );
    }

    if (
      !data.palette ||
      typeof data.palette !== "object" ||
      Array.isArray(data.palette)
    ) {
      throw new Error("The chart needs a palette object.");
    }

    const paletteEntries = Object.entries(data.palette);
    if (paletteEntries.length < 1 || paletteEntries.length > 36) {
      throw new Error("The palette must contain between 1 and 36 colors.");
    }

    const paletteKeysInput = new Set(paletteEntries.map(([key]) => key));
    if (!paletteKeysInput.has("0") || !paletteKeysInput.has("1")) {
      throw new Error('The viewer requires palette keys "0" (Color A) and "1" (Color B).');
    }

    const palette = {};
    for (const [key, entry] of paletteEntries) {
      if (!SAFE_PALETTE_KEY.test(key)) {
        throw new Error(
          `Palette key ${JSON.stringify(key)} is invalid. Palette keys must be one letter or number.`
        );
      }

      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Palette entry ${key} is invalid.`);
      }

      const hex = String(entry.hex || "").toUpperCase();
      if (!HEX_COLOR.test(hex)) {
        throw new Error(`Palette entry ${key} needs a valid six-digit hex color.`);
      }

      palette[key] = {
        id:
          Number.isFinite(Number(entry.id))
            ? Number(entry.id)
            : key,
        name: cleanText(
          entry.name,
          MAX_PALETTE_NAME_LENGTH,
          `Color ${key}`
        ),
        hex,
        rgb: rgbFromHex(hex)
      };
    }

    if (!Array.isArray(data.rows) || data.rows.length !== rows) {
      throw new Error(`The chart must contain exactly ${rows} row records.`);
    }

    const paletteKeys = new Set(Object.keys(palette));
    const foundRows = new Set();
    const normalizedRows = [];

    for (const sourceRow of data.rows) {
      if (!sourceRow || typeof sourceRow !== "object") {
        throw new Error("A chart row is invalid.");
      }

      const number = Number(sourceRow.number);
      if (!Number.isInteger(number) || number < 1 || number > rows) {
        throw new Error("A row has an invalid row number.");
      }

      if (foundRows.has(number)) {
        throw new Error(`Row ${number} appears more than once.`);
      }
      foundRows.add(number);

      const colors = String(sourceRow.colors ?? "");
      const rowStitches = String(sourceRow.stitches ?? "");

      if (colors.length !== stitches) {
        throw new Error(
          `Row ${number} has ${colors.length} color cells; ${stitches} are required.`
        );
      }

      if (rowStitches.length !== stitches) {
        throw new Error(
          `Row ${number} has ${rowStitches.length} stitch cells; ${stitches} are required.`
        );
      }

      for (const colorKey of colors) {
        if (!paletteKeys.has(colorKey)) {
          throw new Error(
            `Row ${number} uses palette key ${JSON.stringify(colorKey)}, which is not defined.`
          );
        }
      }

      for (const code of rowStitches) {
        if (!VALID_STITCH_CODES.has(code)) {
          throw new Error(
            `Row ${number} contains unsupported stitch code ${JSON.stringify(code)}.`
          );
        }
      }

      const workingColor = String(sourceRow.workingColor || "");
      if (!["A", "B"].includes(workingColor)) {
        throw new Error(`Row ${number} needs workingColor "A" or "B".`);
      }

      normalizedRows.push({
        number,
        workingColor,
        colors,
        stitches: rowStitches
      });
    }

    normalizedRows.sort((left, right) => left.number - right.number);

    for (let row = 1; row <= rows; row += 1) {
      if (!foundRows.has(row)) throw new Error(`Row ${row} is missing.`);
    }

    const firstPaletteId = Object.keys(palette)[0];
    let foundation;

    if (data.foundation == null) {
      foundation = {
        row: 0,
        workingColor: "A",
        colors: firstPaletteId.repeat(stitches),
        stitches: "c".repeat(stitches)
      };
    } else {
      if (
        typeof data.foundation !== "object" ||
        Array.isArray(data.foundation)
      ) {
        throw new Error("The foundation row is invalid.");
      }

      const colors = String(data.foundation.colors ?? "");
      const foundationStitches = String(data.foundation.stitches ?? "");
      const workingColor = String(data.foundation.workingColor || "A");

      if (colors.length !== stitches) {
        throw new Error(
          `The foundation row has ${colors.length} color cells; ${stitches} are required.`
        );
      }

      if (foundationStitches.length !== stitches) {
        throw new Error(
          `The foundation row has ${foundationStitches.length} stitch cells; ${stitches} are required.`
        );
      }

      for (const colorKey of colors) {
        if (!paletteKeys.has(colorKey)) {
          throw new Error(
            `The foundation row uses undefined palette key ${JSON.stringify(colorKey)}.`
          );
        }
      }

      for (const code of foundationStitches) {
        if (!VALID_STITCH_CODES.has(code)) {
          throw new Error(
            `The foundation row contains unsupported stitch code ${JSON.stringify(code)}.`
          );
        }
      }

      if (!["A", "B"].includes(workingColor)) {
        throw new Error('The foundation row needs workingColor "A" or "B".');
      }

      foundation = {
        row: 0,
        workingColor,
        colors,
        stitches: foundationStitches
      };
    }

    const title = cleanText(data.title, MAX_TITLE_LENGTH, "Untitled crochet chart");
    const chartId = slugify(data.chartId || `${title}-${rows}x${stitches}`);

    const normalized = {
      schemaVersion: 2,
      chartId,
      title,
      source: normalizeSource(data.source),
      dimensions: {
        rows,
        stitchesPerRow: stitches,
        foundationRow: 0
      },
      orientation: {
        jsonRowOrder: `row 1 through row ${rows}`,
        jsonStitchOrder: `stitch 1 through stitch ${stitches}`,
        chartDisplayTopRow: rows,
        chartDisplayBottomRow: 0,
        chartDisplayLeftStitch: stitches,
        chartDisplayRightStitch: 1
      },
      palette,
      stitchCodes: {
        s: "single crochet (blank cell)",
        d: "double crochet (X)",
        b: "border stitch (BS)",
        c: "chain"
      },
      foundation,
      binaryRows: normalizedRows.map((row) => row.colors),
      rows: normalizedRows
    };

    if (data.design && typeof data.design === "object" && !Array.isArray(data.design)) {
      normalized.design = normalizeSource(data.design);
    }

    return normalized;
  }

  function normalizeProgress(progress, chart) {
    const rows = chart.dimensions.rows;
    const stitches = chart.dimensions.stitchesPerRow;
    const requestedSegmentSize =
      Number(progress?.view?.segmentSize) ||
      Number(progress?.segmentSize) ||
      DEFAULT_SEGMENT_SIZE;

    const segmentSize = Math.max(
      1,
      Math.min(stitches, Math.round(requestedSegmentSize))
    );

    const segmentCount = Math.ceil(stitches / segmentSize);
    const completedSet = new Set();

    if (Array.isArray(progress?.completed)) {
      for (const value of progress.completed) {
        const match = String(value).match(/^(\d+):(\d+)$/);
        if (!match) continue;

        const row = Number(match[1]);
        const stitch = Number(match[2]);

        if (
          row >= 0 &&
          row <= rows &&
          stitch >= 1 &&
          stitch <= stitches
        ) {
          completedSet.add(`${row}:${stitch}`);
        }
      }
    }

    const row = Math.max(
      1,
      Math.min(rows, Math.round(Number(progress?.current?.row) || 1))
    );

    const segment = Math.max(
      1,
      Math.min(
        segmentCount,
        Math.round(Number(progress?.current?.segment) || 1)
      )
    );

    const segmentStart = (segment - 1) * segmentSize + 1;
    const segmentEnd = Math.min(segmentStart + segmentSize - 1, stitches);
    const stitch = Math.max(
      segmentStart,
      Math.min(
        segmentEnd,
        Math.round(Number(progress?.current?.stitch) || segmentStart)
      )
    );

    return {
      completed: [...completedSet],
      current: { row, segment, stitch },
      view: {
        cellSize: Math.max(
          4,
          Math.min(120, Number(progress?.view?.cellSize) || 44)
        ),
        focusSegment:
          typeof progress?.view?.focusSegment === "boolean"
            ? progress.view.focusSegment
            : true,
        showGrid:
          typeof progress?.view?.showGrid === "boolean"
            ? progress.view.showGrid
            : true,
        showSymbols:
          typeof progress?.view?.showSymbols === "boolean"
            ? progress.view.showSymbols
            : true,
        showFoundation:
          typeof progress?.view?.showFoundation === "boolean"
            ? progress.view.showFoundation
            : false,
        scrollMode:
          ["center", "visible", "off"].includes(progress?.view?.scrollMode)
            ? progress.view.scrollMode
            : progress?.view?.autoCenter === false
              ? "off"
              : "center",
        autoCenter:
          ["center", "visible"].includes(progress?.view?.scrollMode)
            ? true
            : typeof progress?.view?.autoCenter === "boolean"
              ? progress.view.autoCenter
              : true,
        keepScreenAwake:
          typeof progress?.view?.keepScreenAwake === "boolean"
            ? progress.view.keepScreenAwake
            : false,
        crochetMode:
          typeof progress?.view?.crochetMode === "boolean"
            ? progress.view.crochetMode
            : false,
        segmentSize
      }
    };
  }

  function normalizeProject(project, index = 0) {
    if (!project || typeof project !== "object") {
      throw new Error(`Backup project ${index + 1} is invalid.`);
    }

    const chart = validateChart(project.chart);
    const now = new Date().toISOString();
    const name = normalizeProjectName(
      project.name,
      chart.title || `Project ${index + 1}`
    );

    return {
      id: cleanText(project.id, 180, makeId()),
      name,
      chart,
      progress: normalizeProgress(project.progress, chart),
      sourceFileName: cleanText(
        project.sourceFileName,
        MAX_SOURCE_FILE_NAME_LENGTH
      ),
      archived: Boolean(project.archived),
      notes: cleanMultilineText(project.notes, MAX_PROJECT_NOTES_LENGTH),
      details: normalizeProjectDetails(project.details),
      rowNotes: normalizeRowNotes(project.rowNotes, chart),
      createdAt: String(project.createdAt || now),
      updatedAt: String(project.updatedAt || now)
    };
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function encodeCompleted(completed, chart) {
    const stitches = chart.dimensions.stitchesPerRow;
    const total = (chart.dimensions.rows + 1) * stitches;
    const bytes = new Uint8Array(Math.ceil(total / 8));

    for (const key of completed) {
      const match = String(key).match(/^(\d+):(\d+)$/);
      if (!match) continue;

      const row = Number(match[1]);
      const stitch = Number(match[2]);
      if (
        row < 0 ||
        row > chart.dimensions.rows ||
        stitch < 1 ||
        stitch > stitches
      ) {
        continue;
      }

      const bitIndex = row * stitches + stitch - 1;
      bytes[bitIndex >> 3] |= 1 << (bitIndex & 7);
    }

    return bytesToBase64(bytes);
  }

  function decodeCompleted(encoded, chart) {
    if (typeof encoded !== "string" || !encoded) return [];

    const bytes = base64ToBytes(encoded);
    const stitches = chart.dimensions.stitchesPerRow;
    const rows = chart.dimensions.rows;
    const completed = [];

    for (let row = 0; row <= rows; row += 1) {
      for (let stitch = 1; stitch <= stitches; stitch += 1) {
        const bitIndex = row * stitches + stitch - 1;
        if (bytes[bitIndex >> 3] & (1 << (bitIndex & 7))) {
          completed.push(`${row}:${stitch}`);
        }
      }
    }

    return completed;
  }

  function compactProgressRecord(projectId, progress, chart, updatedAt = new Date().toISOString()) {
    const normalized = normalizeProgress(progress, chart);

    return {
      projectId,
      dataVersion: APP_DATA_VERSION,
      completedBits: encodeCompleted(normalized.completed, chart),
      completedCount: normalized.completed.length,
      current: normalized.current,
      view: normalized.view,
      updatedAt
    };
  }

  function progressFromRecord(record, chart, fallback) {
    if (record?.completedBits) {
      return normalizeProgress(
        {
          completed: decodeCompleted(record.completedBits, chart),
          current: record.current,
          view: record.view
        },
        chart
      );
    }

    return normalizeProgress(fallback || {}, chart);
  }

  function projectForStorage(project) {
    const stored = {
      id: project.id,
      name: project.name,
      chart: project.chart,
      sourceFileName: project.sourceFileName || "",
      archived: Boolean(project.archived),
      notes: project.notes || "",
      details: normalizeProjectDetails(project.details),
      rowNotes: normalizeRowNotes(project.rowNotes, project.chart),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    };

    return stored;
  }

  function supportsFileAutoBackup() {
    return typeof window.showSaveFilePicker === "function";
  }

  function statusSnapshot() {
    return {
      ...backupState,
      supported: supportsFileAutoBackup(),
      enabled: autoBackupEnabled,
      hasHandle: Boolean(autoBackupHandle),
      storageMode: mode
    };
  }

  function emitBackupStatus(changes = {}) {
    backupState = {
      ...backupState,
      ...changes,
      supported: supportsFileAutoBackup(),
      enabled: autoBackupEnabled,
      hasHandle: Boolean(autoBackupHandle)
    };

    const snapshot = statusSnapshot();

    for (const listener of backupListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn("A backup-status listener failed.", error);
      }
    }

    window.dispatchEvent(
      new CustomEvent("mosaic-crochet-backup-status", {
        detail: snapshot
      })
    );

    return snapshot;
  }

  function onAutoBackupStatus(listener) {
    backupListeners.add(listener);
    listener(statusSnapshot());

    return () => backupListeners.delete(listener);
  }

  function openDatabase() {
    return new Promise((resolve) => {
      if (!("indexedDB" in window)) {
        mode = "localStorage";
        resolve(null);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(PROJECT_STORE)) {
          database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        }

        if (!database.objectStoreNames.contains(PROGRESS_STORE)) {
          database.createObjectStore(PROGRESS_STORE, { keyPath: "projectId" });
        }

        if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
          database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onerror = () => {
        console.warn("IndexedDB unavailable; using localStorage fallback.");
        mode = "localStorage";
        resolve(null);
      };
    });
  }

  function transactionResult(storeNames, access, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, access);
      let result;

      try {
        result = action(tx);
      } catch (error) {
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction was aborted."));
    });
  }

  function readLocalProjects() {
    try {
      return JSON.parse(localStorage.getItem(FALLBACK_PROJECTS) || "[]");
    } catch {
      return [];
    }
  }

  function writeLocalProjects(projects) {
    localStorage.setItem(FALLBACK_PROJECTS, JSON.stringify(projects));
  }

  function readLocalSettings() {
    try {
      return JSON.parse(localStorage.getItem(FALLBACK_SETTINGS) || "{}");
    } catch {
      return {};
    }
  }

  function writeLocalSettings(settings) {
    localStorage.setItem(FALLBACK_SETTINGS, JSON.stringify(settings));
  }

  async function getSetting(key) {
    if (mode === "indexeddb" && db) {
      const request = await transactionResult(
        SETTINGS_STORE,
        "readonly",
        (tx) => tx.objectStore(SETTINGS_STORE).get(key)
      );
      return request?.result?.value;
    }

    return readLocalSettings()[key];
  }

  async function setSetting(key, value) {
    if (mode === "indexeddb" && db) {
      await transactionResult(
        SETTINGS_STORE,
        "readwrite",
        (tx) => tx.objectStore(SETTINGS_STORE).put({ key, value })
      );
      return;
    }

    if (key === AUTO_BACKUP_HANDLE_KEY) return;

    const settings = readLocalSettings();
    settings[key] = value;
    writeLocalSettings(settings);
  }

  async function deleteSetting(key) {
    if (mode === "indexeddb" && db) {
      await transactionResult(
        SETTINGS_STORE,
        "readwrite",
        (tx) => tx.objectStore(SETTINGS_STORE).delete(key)
      );
      return;
    }

    const settings = readLocalSettings();
    delete settings[key];
    writeLocalSettings(settings);
  }

  function recoveryStorageKey(projectId) {
    return `${RECOVERY_PREFIX}${projectId}`;
  }

  function saveRecoveryProgress(projectId, progress, chart) {
    try {
      const record = compactProgressRecord(
        projectId,
        progress,
        chart,
        new Date().toISOString()
      );
      localStorage.setItem(recoveryStorageKey(projectId), JSON.stringify(record));
    } catch (error) {
      console.warn("Could not write the emergency recovery journal.", error);
    }
  }

  function clearRecoveryProgress(projectId) {
    try {
      localStorage.removeItem(recoveryStorageKey(projectId));
    } catch {
      // Ignore unavailable localStorage.
    }
  }

  function readRecoveryProgress(projectId, chart) {
    try {
      const raw = localStorage.getItem(recoveryStorageKey(projectId));
      if (!raw) return null;
      const record = JSON.parse(raw);

      return {
        record,
        progress: progressFromRecord(record, chart, {})
      };
    } catch {
      return null;
    }
  }

  async function list() {
    if (mode !== "indexeddb" || !db) {
      return readLocalProjects()
        .map((project, index) => normalizeProject(project, index))
        .sort((a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
        );
    }

    const requests = await transactionResult(
      [PROJECT_STORE, PROGRESS_STORE],
      "readonly",
      (tx) => ({
        projects: tx.objectStore(PROJECT_STORE).getAll(),
        progress: tx.objectStore(PROGRESS_STORE).getAll()
      })
    );

    const progressById = new Map(
      (requests.progress.result || []).map((record) => [record.projectId, record])
    );

    return (requests.projects.result || [])
      .map((stored) => {
        const progressRecord = progressById.get(stored.id);
        const recovery = readRecoveryProgress(stored.id, stored.chart);
        const storedUpdated = progressRecord?.updatedAt || stored.updatedAt || "";
        const useRecovery =
          recovery?.record?.updatedAt &&
          String(recovery.record.updatedAt) > String(storedUpdated);

        const progress = useRecovery
          ? recovery.progress
          : progressFromRecord(progressRecord, stored.chart, stored.progress);

        return {
          ...stored,
          notes: cleanMultilineText(stored.notes, MAX_PROJECT_NOTES_LENGTH),
          details: normalizeProjectDetails(stored.details),
          rowNotes: normalizeRowNotes(stored.rowNotes, stored.chart),
          progress,
          updatedAt: useRecovery
            ? recovery.record.updatedAt
            : progressRecord?.updatedAt || stored.updatedAt
        };
      })
      .sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
      );
  }

  async function get(projectId) {
    if (mode !== "indexeddb" || !db) {
      const project = readLocalProjects().find((item) => item.id === projectId);
      return project ? normalizeProject(project) : null;
    }

    const requests = await transactionResult(
      [PROJECT_STORE, PROGRESS_STORE],
      "readonly",
      (tx) => ({
        project: tx.objectStore(PROJECT_STORE).get(projectId),
        progress: tx.objectStore(PROGRESS_STORE).get(projectId)
      })
    );

    const stored = requests.project.result;
    if (!stored) return null;

    const progressRecord = requests.progress.result;
    const recovery = readRecoveryProgress(projectId, stored.chart);
    const storedUpdated = progressRecord?.updatedAt || stored.updatedAt || "";
    const useRecovery =
      recovery?.record?.updatedAt &&
      String(recovery.record.updatedAt) > String(storedUpdated);

    return {
      ...stored,
      notes: cleanMultilineText(stored.notes, MAX_PROJECT_NOTES_LENGTH),
      details: normalizeProjectDetails(stored.details),
      rowNotes: normalizeRowNotes(stored.rowNotes, stored.chart),
      progress: useRecovery
        ? recovery.progress
        : progressFromRecord(progressRecord, stored.chart, stored.progress),
      updatedAt: useRecovery
        ? recovery.record.updatedAt
        : progressRecord?.updatedAt || stored.updatedAt
    };
  }

  function scheduleAutoBackup() {
    if (
      suppressAutoBackup > 0 ||
      !autoBackupEnabled ||
      !autoBackupHandle
    ) {
      return;
    }

    clearTimeout(autoBackupTimer);
    emitBackupStatus({ pending: true, saving: false, error: "" });

    autoBackupTimer = setTimeout(() => {
      writeAutoBackup({ requestPermission: false }).catch((error) => {
        console.warn("Automatic backup failed.", error);
      });
    }, AUTO_BACKUP_DELAY);
  }

  async function put(project) {
    const normalized = normalizeProject(project);
    normalized.updatedAt = String(project.updatedAt || new Date().toISOString());

    if (mode === "indexeddb" && db) {
      const progressRecord = compactProgressRecord(
        normalized.id,
        normalized.progress,
        normalized.chart,
        normalized.updatedAt
      );

      await transactionResult(
        [PROJECT_STORE, PROGRESS_STORE],
        "readwrite",
        (tx) => {
          tx.objectStore(PROJECT_STORE).put(projectForStorage(normalized));
          tx.objectStore(PROGRESS_STORE).put(progressRecord);
        }
      );
    } else {
      const projects = readLocalProjects();
      const index = projects.findIndex((item) => item.id === normalized.id);

      if (index >= 0) projects[index] = normalized;
      else projects.push(normalized);

      writeLocalProjects(projects);
    }

    clearRecoveryProgress(normalized.id);
    scheduleAutoBackup();
    return normalized;
  }

  async function remove(projectId) {
    if (mode === "indexeddb" && db) {
      await transactionResult(
        [PROJECT_STORE, PROGRESS_STORE],
        "readwrite",
        (tx) => {
          tx.objectStore(PROJECT_STORE).delete(projectId);
          tx.objectStore(PROGRESS_STORE).delete(projectId);
        }
      );
    } else {
      writeLocalProjects(
        readLocalProjects().filter((project) => project.id !== projectId)
      );
    }

    clearRecoveryProgress(projectId);
    scheduleAutoBackup();
  }

  function defaultProgress(chart) {
    const legacyKey =
      `crochet-chart-progress:${chart.chartId || "original-geometric-bloom-demo-v1"}`;

    try {
      const legacy = JSON.parse(localStorage.getItem(legacyKey) || "null");
      if (legacy && Array.isArray(legacy.completed)) {
        return normalizeProgress(legacy, chart);
      }
    } catch {
      // Ignore invalid legacy data.
    }

    return normalizeProgress({}, chart);
  }

  async function create(name, chartData, sourceFileName = "") {
    const chart = validateChart(chartData);
    const now = new Date().toISOString();

    return await put({
      id: makeId(),
      name: normalizeProjectName(name, chart.title),
      chart,
      progress: defaultProgress(chart),
      sourceFileName: cleanText(
        sourceFileName,
        MAX_SOURCE_FILE_NAME_LENGTH
      ),
      archived: false,
      notes: "",
      details: normalizeProjectDetails({}),
      rowNotes: {},
      createdAt: now,
      updatedAt: now
    });
  }

  async function rename(projectId, name) {
    const project = await get(projectId);
    if (!project) throw new Error("Project not found.");

    project.name = normalizeProjectName(name, project.chart.title);
    project.updatedAt = new Date().toISOString();
    return await put(project);
  }

  async function setArchived(projectId, archived) {
    const project = await get(projectId);
    if (!project) throw new Error("Project not found.");

    project.archived = Boolean(archived);
    project.updatedAt = new Date().toISOString();
    return await put(project);
  }

  async function duplicate(projectId, includeProgress = true) {
    const project = await get(projectId);
    if (!project) throw new Error("Project not found.");

    const now = new Date().toISOString();
    return await put({
      ...clone(project),
      id: makeId(),
      name: normalizeProjectName(`${project.name} Copy`),
      progress: includeProgress
        ? clone(project.progress)
        : defaultProgress(project.chart),
      archived: false,
      createdAt: now,
      updatedAt: now
    });
  }

  async function updateChart(projectId, chartData) {
    const project = await get(projectId);
    if (!project) throw new Error("Project not found.");

    project.chart = validateChart(chartData);
    project.progress = normalizeProgress(project.progress, project.chart);
    project.updatedAt = new Date().toISOString();
    return await put(project);
  }

  async function updateProgress(projectId, progress, chartHint = null) {
    let chart = chartHint;
    let project = null;

    if (!chart) {
      project = await get(projectId);
      if (!project) throw new Error("Project not found.");
      chart = project.chart;
    }

    const normalizedChart = chartHint ? chart : validateChart(chart);
    const normalized = normalizeProgress(progress, normalizedChart);
    const updatedAt = new Date().toISOString();

    if (mode === "indexeddb" && db) {
      await transactionResult(
        PROGRESS_STORE,
        "readwrite",
        (tx) =>
          tx.objectStore(PROGRESS_STORE).put(
            compactProgressRecord(
              projectId,
              normalized,
              normalizedChart,
              updatedAt
            )
          )
      );
    } else {
      const projects = readLocalProjects();
      const index = projects.findIndex((item) => item.id === projectId);
      if (index < 0) throw new Error("Project not found.");

      projects[index].progress = normalized;
      projects[index].updatedAt = updatedAt;
      writeLocalProjects(projects);
      project = projects[index];
    }

    clearRecoveryProgress(projectId);
    scheduleAutoBackup();

    return project
      ? {
          ...project,
          progress: normalized,
          updatedAt
        }
      : {
          id: projectId,
          chart: normalizedChart,
          progress: normalized,
          updatedAt
        };
  }

  async function replaceAllProjects(projects) {
    const normalized = projects.map(normalizeProject);
    suppressAutoBackup += 1;

    try {
      if (mode === "indexeddb" && db) {
        await transactionResult(
          [PROJECT_STORE, PROGRESS_STORE],
          "readwrite",
          (tx) => {
            const projectStore = tx.objectStore(PROJECT_STORE);
            const progressStore = tx.objectStore(PROGRESS_STORE);
            projectStore.clear();
            progressStore.clear();

            for (const project of normalized) {
              projectStore.put(projectForStorage(project));
              progressStore.put(
                compactProgressRecord(
                  project.id,
                  project.progress,
                  project.chart,
                  project.updatedAt
                )
              );
            }
          }
        );
      } else {
        writeLocalProjects(normalized);
      }

      await setSetting("publicDemoSeededV1", true);
    } finally {
      suppressAutoBackup -= 1;
    }

    scheduleAutoBackup();
    return normalized;
  }

  async function mergeProjects(projects) {
    const existing = await list();
    const ids = new Set(existing.map((project) => project.id));
    const names = new Set(existing.map((project) => project.name.toLowerCase()));
    const imported = [];

    suppressAutoBackup += 1;
    try {
      for (const source of projects.map(normalizeProject)) {
        const project = clone(source);

        if (ids.has(project.id)) {
          project.id = makeId();
        }

        let baseName = project.name;
        let candidate = baseName;
        let suffix = 2;
        while (names.has(candidate.toLowerCase())) {
          candidate = `${baseName} (Imported ${suffix})`;
          suffix += 1;
        }

        project.name = normalizeProjectName(candidate);
        project.updatedAt = new Date().toISOString();
        ids.add(project.id);
        names.add(project.name.toLowerCase());
        imported.push(await put(project));
      }
    } finally {
      suppressAutoBackup -= 1;
    }

    scheduleAutoBackup();
    return imported;
  }

  async function seedStarter(starterChart) {
    const seeded = await getSetting("publicDemoSeededV1");
    if (seeded) return;

    const chart = validateChart(starterChart);
    const now = new Date().toISOString();

    await put({
      id: "starter-geometric-bloom-demo",
      name: "Geometric Bloom Demo",
      chart,
      progress: defaultProgress(chart),
      sourceFileName: "demo-geometric-bloom.json",
      archived: false,
      notes: "",
      details: normalizeProjectDetails({}),
      rowNotes: {},
      createdAt: now,
      updatedAt: now
    });

    await setSetting("publicDemoSeededV1", true);
  }

  async function queryPermission(handle = autoBackupHandle) {
    if (!handle) return "unknown";

    try {
      if (typeof handle.queryPermission === "function") {
        return await handle.queryPermission({ mode: "readwrite" });
      }
    } catch (error) {
      console.warn("Could not query backup-file permission.", error);
    }

    return "unknown";
  }

  async function loadAutoBackupConfiguration() {
    autoBackupEnabled = Boolean(await getSetting(AUTO_BACKUP_ENABLED_KEY));

    const lastSavedAt =
      await getSetting(AUTO_BACKUP_LAST_SAVED_KEY) || null;
    const fileName =
      await getSetting(AUTO_BACKUP_FILE_NAME_KEY) || "";

    let persistentHandle = false;

    if (mode === "indexeddb") {
      try {
        autoBackupHandle =
          await getSetting(AUTO_BACKUP_HANDLE_KEY) || null;
        persistentHandle = Boolean(autoBackupHandle);
      } catch (error) {
        console.warn("Could not restore the backup-file handle.", error);
        autoBackupHandle = null;
      }
    }

    if (!autoBackupHandle) autoBackupEnabled = false;

    const permission = await queryPermission(autoBackupHandle);

    emitBackupStatus({
      enabled: autoBackupEnabled,
      fileName: autoBackupHandle?.name || fileName || "",
      permission,
      persistentHandle,
      lastSavedAt,
      pending: false,
      saving: false,
      error: ""
    });
  }

  async function buildBackupPayload() {
    const projects = await list();

    return {
      backupType: BACKUP_TYPE,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appDataVersion: APP_DATA_VERSION,
      exportedAt: new Date().toISOString(),
      projectCount: projects.length,
      projects: clone(projects)
    };
  }

  async function writeAutoBackup({ requestPermission = false } = {}) {
    clearTimeout(autoBackupTimer);

    if (!autoBackupEnabled || !autoBackupHandle) {
      return emitBackupStatus({
        pending: false,
        saving: false,
        error: "Auto-backup is not connected."
      });
    }

    let permission = "unknown";

    try {
      if (
        requestPermission &&
        typeof autoBackupHandle.requestPermission === "function"
      ) {
        permission = await autoBackupHandle.requestPermission({
          mode: "readwrite"
        });
      } else {
        permission = await queryPermission(autoBackupHandle);
      }

      if (permission !== "granted") {
        return emitBackupStatus({
          permission,
          pending: false,
          saving: false,
          error:
            permission === "prompt"
              ? "Permission is needed to update the backup file."
              : "Access to the backup file was not granted."
        });
      }

      emitBackupStatus({
        permission,
        pending: false,
        saving: true,
        error: ""
      });

      const payload = await buildBackupPayload();
      const writable = await autoBackupHandle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();

      const lastSavedAt = new Date().toISOString();
      await setSetting(AUTO_BACKUP_LAST_SAVED_KEY, lastSavedAt);

      return emitBackupStatus({
        fileName: autoBackupHandle.name || backupState.fileName,
        permission: "granted",
        pending: false,
        saving: false,
        lastSavedAt,
        error: ""
      });
    } catch (error) {
      emitBackupStatus({
        permission,
        pending: false,
        saving: false,
        error: error?.message || "The backup file could not be updated."
      });
      throw error;
    }
  }

  async function enableAutoBackup() {
    if (!supportsFileAutoBackup()) {
      throw new Error(
        "Automatic file backup is not available in this browser. Use Download Backup instead."
      );
    }

    const handle = await window.showSaveFilePicker({
      id: "mosaic-crochet-backup",
      suggestedName: "mosaic-crochet-library-backup.json",
      types: [
        {
          description: "Mosaic Crochet library backup",
          accept: { "application/json": [".json"] }
        }
      ]
    });

    autoBackupHandle = handle;
    autoBackupEnabled = true;
    let persistentHandle = false;

    if (mode === "indexeddb") {
      try {
        await setSetting(AUTO_BACKUP_HANDLE_KEY, handle);
        persistentHandle = true;
      } catch (error) {
        console.warn(
          "The file handle could not be remembered after this session.",
          error
        );
      }
    }

    await setSetting(AUTO_BACKUP_ENABLED_KEY, true);
    await setSetting(AUTO_BACKUP_FILE_NAME_KEY, handle.name || "");

    emitBackupStatus({
      enabled: true,
      fileName: handle.name || "",
      permission: "granted",
      persistentHandle,
      pending: true,
      saving: false,
      error: ""
    });

    return await writeAutoBackup({ requestPermission: false });
  }

  async function reconnectAutoBackup() {
    if (!autoBackupHandle) return await enableAutoBackup();
    return await writeAutoBackup({ requestPermission: true });
  }

  async function backupNow() {
    if (!autoBackupEnabled || !autoBackupHandle) {
      return await enableAutoBackup();
    }
    return await writeAutoBackup({ requestPermission: true });
  }

  async function flushAutoBackup() {
    clearTimeout(autoBackupTimer);
    if (!autoBackupEnabled || !autoBackupHandle) return statusSnapshot();
    return await writeAutoBackup({ requestPermission: false });
  }

  async function chooseNewAutoBackupFile() {
    return await enableAutoBackup();
  }

  async function disableAutoBackup() {
    clearTimeout(autoBackupTimer);
    autoBackupEnabled = false;
    autoBackupHandle = null;

    await setSetting(AUTO_BACKUP_ENABLED_KEY, false);
    await deleteSetting(AUTO_BACKUP_HANDLE_KEY);
    await deleteSetting(AUTO_BACKUP_FILE_NAME_KEY);

    return emitBackupStatus({
      enabled: false,
      fileName: "",
      permission: "unknown",
      persistentHandle: false,
      pending: false,
      saving: false,
      error: ""
    });
  }

  async function getAutoBackupStatus() {
    const permission = await queryPermission(autoBackupHandle);
    return emitBackupStatus({
      permission,
      fileName: autoBackupHandle?.name || backupState.fileName || ""
    });
  }

  async function buildProjectBackupPayload(projectId) {
    const project = await get(projectId);
    if (!project) throw new Error("Project not found.");

    return {
      backupType: PROJECT_BACKUP_TYPE,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appDataVersion: APP_DATA_VERSION,
      exportedAt: new Date().toISOString(),
      projectCount: 1,
      projects: [clone(project)]
    };
  }

  async function downloadProject(projectId) {
    const payload = await buildProjectBackupPayload(projectId);
    const project = payload.projects[0];
    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName = slugify(project.name || "mosaic-crochet-project");

    anchor.href = url;
    anchor.download = `${safeName}-project-backup.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return payload;
  }

  async function downloadBackup() {
    const payload = await buildBackupPayload();
    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    anchor.href = url;
    anchor.download = `mosaic-crochet-library-backup-${date}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return payload;
  }

  function parseBackupText(text) {
    let payload;

    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("The selected backup is not valid JSON.");
    }

    const isLibraryBackup =
      payload?.backupType === BACKUP_TYPE && Array.isArray(payload.projects);
    const isProjectBackup =
      payload?.backupType === PROJECT_BACKUP_TYPE &&
      (payload.project || Array.isArray(payload.projects));

    if (!isLibraryBackup && !isProjectBackup) {
      throw new Error(
        "This is not a compatible Mosaic Crochet library or project backup."
      );
    }

    const sourceProjects = isLibraryBackup
      ? payload.projects
      : Array.isArray(payload.projects)
        ? payload.projects
        : [payload.project];
    const projects = sourceProjects.map(normalizeProject);

    return {
      payload,
      projects,
      summary: {
        exportedAt: payload.exportedAt || null,
        projectCount: projects.length,
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          rows: project.chart.dimensions.rows,
          stitchesPerRow: project.chart.dimensions.stitchesPerRow,
          percent:
            project.chart.dimensions.rows * project.chart.dimensions.stitchesPerRow
              ? project.progress.completed.filter(
                  (key) => !String(key).startsWith("0:")
                ).length /
                (project.chart.dimensions.rows *
                  project.chart.dimensions.stitchesPerRow) *
                100
              : 0
        }))
      }
    };
  }

  async function inspectBackupFile(file) {
    if (file?.size > MAX_BACKUP_FILE_BYTES) {
      throw new Error(
        `The backup is larger than ${Math.round(MAX_BACKUP_FILE_BYTES / 1024 / 1024)} MB.`
      );
    }

    return parseBackupText(await file.text());
  }

  async function savePreRestoreRecovery() {
    try {
      await setSetting(PRE_RESTORE_RECOVERY_KEY, await buildBackupPayload());
      return true;
    } catch (error) {
      console.warn("Could not save the pre-restore recovery copy.", error);
      return false;
    }
  }

  async function hasRestoreRecovery() {
    return Boolean(await getSetting(PRE_RESTORE_RECOVERY_KEY));
  }

  async function restorePreviousLibrary() {
    const payload = await getSetting(PRE_RESTORE_RECOVERY_KEY);
    if (!payload?.projects) {
      throw new Error("No previous library recovery copy is available.");
    }

    const current = await buildBackupPayload();
    await replaceAllProjects(payload.projects);
    await setSetting(PRE_RESTORE_RECOVERY_KEY, current);
    await flushAutoBackup();
    return await list();
  }

  async function restoreBackupFile(
    file,
    restoreMode = "replace",
    selectedProjectIds = null
  ) {
    const inspection = await inspectBackupFile(file);
    const selectedIds = Array.isArray(selectedProjectIds)
      ? new Set(selectedProjectIds.map(String))
      : null;
    const selectedProjects = selectedIds
      ? inspection.projects.filter((project) => selectedIds.has(String(project.id)))
      : inspection.projects;

    if (!selectedProjects.length) {
      throw new Error("Select at least one project to restore.");
    }

    await savePreRestoreRecovery();

    const projects =
      restoreMode === "merge"
        ? await mergeProjects(selectedProjects)
        : await replaceAllProjects(selectedProjects);

    await flushAutoBackup();

    return {
      mode: restoreMode,
      projects,
      summary: inspection.summary
    };
  }

  async function init(starterChart) {
    await openDatabase();
    await loadAutoBackupConfiguration();

    if (starterChart) await seedStarter(starterChart);

    return {
      mode,
      backup: statusSnapshot()
    };
  }

  window.ProjectStore = {
    init,
    list,
    get,
    put,
    remove,
    create,
    rename,
    setArchived,
    duplicate,
    updateChart,
    updateProgress,
    replaceAllProjects,
    mergeProjects,
    validateChart,
    defaultProgress,
    normalizeProgress,
    saveRecoveryProgress,
    buildBackupPayload,
    buildProjectBackupPayload,
    downloadBackup,
    downloadProject,
    inspectBackupFile,
    restoreBackupFile,
    hasRestoreRecovery,
    restorePreviousLibrary,
    enableAutoBackup,
    reconnectAutoBackup,
    chooseNewAutoBackupFile,
    backupNow,
    flushAutoBackup,
    disableAutoBackup,
    getAutoBackupStatus,
    onAutoBackupStatus,
    limits: {
      maxChartCells: MAX_CHART_CELLS,
      maxJsonFileBytes: MAX_JSON_FILE_BYTES
    },
    get mode() {
      return mode;
    }
  };
})();
