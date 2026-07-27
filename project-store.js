(() => {
  "use strict";

  const DB_NAME = "MosaicCrochetProjectViewerPublic";
  const DB_VERSION = 1;
  const PROJECT_STORE = "projects";
  const SETTINGS_STORE = "settings";

  const FALLBACK_PROJECTS = "mosaic-crochet-public-projects:v1";
  const FALLBACK_SETTINGS = "mosaic-crochet-public-settings:v1";

  const DEFAULT_SEGMENT_SIZE = 10;
  const BACKUP_TYPE = "mosaic-crochet-project-library";
  const BACKUP_SCHEMA_VERSION = 1;
  const AUTO_BACKUP_DELAY = 1200;

  const AUTO_BACKUP_ENABLED_KEY = "autoBackupEnabled";
  const AUTO_BACKUP_HANDLE_KEY = "autoBackupFileHandle";
  const AUTO_BACKUP_FILE_NAME_KEY = "autoBackupFileName";
  const AUTO_BACKUP_LAST_SAVED_KEY = "autoBackupLastSavedAt";

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

    return () => {
      backupListeners.delete(listener);
    };
  }

  function validateChart(data) {
    if (!data || typeof data !== "object") {
      throw new Error("The JSON does not contain a chart object.");
    }

    const rows = Number(data.dimensions?.rows);
    const stitches = Number(data.dimensions?.stitchesPerRow);

    if (!Number.isInteger(rows) || rows < 1) {
      throw new Error("The chart needs a valid dimensions.rows value.");
    }

    if (!Number.isInteger(stitches) || stitches < 1) {
      throw new Error("The chart needs a valid dimensions.stitchesPerRow value.");
    }

    if (!data.palette || typeof data.palette !== "object") {
      throw new Error("The chart needs a palette.");
    }

    if (!Array.isArray(data.rows) || data.rows.length !== rows) {
      throw new Error(`The chart must contain exactly ${rows} row records.`);
    }

    const foundRows = new Set();

    for (const row of data.rows) {
      if (!Number.isInteger(row.number) || row.number < 1 || row.number > rows) {
        throw new Error("A row has an invalid row number.");
      }

      if (foundRows.has(row.number)) {
        throw new Error(`Row ${row.number} appears more than once.`);
      }
      foundRows.add(row.number);

      if (typeof row.colors !== "string" || row.colors.length !== stitches) {
        throw new Error(`Row ${row.number} has an invalid colors string.`);
      }

      if (typeof row.stitches !== "string" || row.stitches.length !== stitches) {
        throw new Error(`Row ${row.number} has an invalid stitches string.`);
      }
    }

    for (let row = 1; row <= rows; row += 1) {
      if (!foundRows.has(row)) throw new Error(`Row ${row} is missing.`);
    }

    const normalized = clone(data);
    normalized.chartId = String(data.chartId || makeId());
    normalized.title = String(data.title || "Untitled crochet chart");
    normalized.dimensions.rows = rows;
    normalized.dimensions.stitchesPerRow = stitches;

    if (
      !normalized.foundation ||
      typeof normalized.foundation.colors !== "string" ||
      normalized.foundation.colors.length !== stitches ||
      typeof normalized.foundation.stitches !== "string" ||
      normalized.foundation.stitches.length !== stitches
    ) {
      const firstPaletteId = Object.keys(normalized.palette)[0] || "0";
      normalized.foundation = {
        number: 0,
        workingColor: "A",
        colors: firstPaletteId.repeat(stitches),
        stitches: "c".repeat(stitches)
      };
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

    const completed = Array.isArray(progress?.completed)
      ? progress.completed.filter((key) => {
          const match = String(key).match(/^(\d+):(\d+)$/);
          if (!match) return false;

          const row = Number(match[1]);
          const stitch = Number(match[2]);

          return row >= 0 && row <= rows && stitch >= 1 && stitch <= stitches;
        })
      : [];

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

    return {
      completed,
      current: { row, segment },
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

    return {
      id: String(project.id || makeId()),
      name: String(project.name || chart.title || `Project ${index + 1}`).trim(),
      chart,
      progress: normalizeProgress(project.progress, chart),
      sourceFileName: String(project.sourceFileName || ""),
      createdAt: String(project.createdAt || now),
      updatedAt: String(project.updatedAt || now)
    };
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

  function transact(storeName, access, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, access);
      const store = tx.objectStore(storeName);
      let request;

      try {
        request = action(store);
      } catch (error) {
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
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
      const record = await transact(
        SETTINGS_STORE,
        "readonly",
        (store) => store.get(key)
      );
      return record?.value;
    }

    return readLocalSettings()[key];
  }

  async function setSetting(key, value) {
    if (mode === "indexeddb" && db) {
      await transact(
        SETTINGS_STORE,
        "readwrite",
        (store) => store.put({ key, value })
      );
      return;
    }

    // File handles cannot be serialized into localStorage.
    if (key === AUTO_BACKUP_HANDLE_KEY) return;

    const settings = readLocalSettings();
    settings[key] = value;
    writeLocalSettings(settings);
  }

  async function deleteSetting(key) {
    if (mode === "indexeddb" && db) {
      await transact(
        SETTINGS_STORE,
        "readwrite",
        (store) => store.delete(key)
      );
      return;
    }

    const settings = readLocalSettings();
    delete settings[key];
    writeLocalSettings(settings);
  }

  async function list() {
    let projects;

    if (mode === "indexeddb" && db) {
      projects = await transact(
        PROJECT_STORE,
        "readonly",
        (store) => store.getAll()
      );
    } else {
      projects = readLocalProjects();
    }

    return (projects || []).sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
    );
  }

  async function get(id) {
    if (mode === "indexeddb" && db) {
      return await transact(
        PROJECT_STORE,
        "readonly",
        (store) => store.get(id)
      );
    }

    return readLocalProjects().find((project) => project.id === id) || null;
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

    emitBackupStatus({
      pending: true,
      saving: false,
      error: ""
    });

    autoBackupTimer = setTimeout(() => {
      writeAutoBackup({ requestPermission: false }).catch((error) => {
        console.warn("Automatic backup failed.", error);
      });
    }, AUTO_BACKUP_DELAY);
  }

  async function put(project) {
    if (mode === "indexeddb" && db) {
      await transact(
        PROJECT_STORE,
        "readwrite",
        (store) => store.put(project)
      );
    } else {
      const projects = readLocalProjects();
      const index = projects.findIndex((item) => item.id === project.id);

      if (index >= 0) projects[index] = project;
      else projects.push(project);

      writeLocalProjects(projects);
    }

    scheduleAutoBackup();
    return project;
  }

  async function remove(id) {
    if (mode === "indexeddb" && db) {
      await transact(
        PROJECT_STORE,
        "readwrite",
        (store) => store.delete(id)
      );
    } else {
      writeLocalProjects(
        readLocalProjects().filter((project) => project.id !== id)
      );
    }

    scheduleAutoBackup();
  }

  function defaultProgress(chart) {
    const legacyKey = `crochet-chart-progress:${chart.chartId || "original-geometric-bloom-demo-v1"}`;

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

    const project = {
      id: makeId(),
      name: String(name || chart.title || "Untitled project").trim(),
      chart,
      progress: defaultProgress(chart),
      sourceFileName,
      createdAt: now,
      updatedAt: now
    };

    await put(project);
    return project;
  }

  async function rename(id, name) {
    const project = await get(id);
    if (!project) throw new Error("Project not found.");

    project.name = String(name).trim();
    project.updatedAt = new Date().toISOString();

    return await put(project);
  }

  async function updateProgress(id, progress) {
    const project = await get(id);
    if (!project) throw new Error("Project not found.");

    project.progress = normalizeProgress(progress, project.chart);
    project.updatedAt = new Date().toISOString();

    return await put(project);
  }

  async function replaceAllProjects(projects) {
    const normalized = projects.map(normalizeProject);
    suppressAutoBackup += 1;

    try {
      if (mode === "indexeddb" && db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(PROJECT_STORE, "readwrite");
          const store = tx.objectStore(PROJECT_STORE);

          store.clear();

          for (const project of normalized) {
            store.put(project);
          }

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
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
    autoBackupEnabled = Boolean(
      await getSetting(AUTO_BACKUP_ENABLED_KEY)
    );

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

    if (!autoBackupHandle) {
      autoBackupEnabled = false;
    }

    const permission = await queryPermission(autoBackupHandle);

    emitBackupStatus({
      enabled: autoBackupEnabled,
      fileName:
        autoBackupHandle?.name ||
        fileName ||
        "",
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
      exportedAt: new Date().toISOString(),
      projectCount: projects.length,
      projects: clone(projects)
    };
  }

  async function writeAutoBackup({ requestPermission = false } = {}) {
    clearTimeout(autoBackupTimer);

    if (!autoBackupEnabled || !autoBackupHandle) {
      emitBackupStatus({
        pending: false,
        saving: false,
        error: "Auto-backup is not connected."
      });

      return statusSnapshot();
    }

    let permission = "unknown";

    try {
      // When permission may need prompting, call requestPermission immediately
      // so it still has the user's button-click activation.
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
        emitBackupStatus({
          permission,
          pending: false,
          saving: false,
          error:
            permission === "prompt"
              ? "Permission is needed to update the backup file."
              : "Access to the backup file was not granted."
        });

        return statusSnapshot();
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

      await setSetting(
        AUTO_BACKUP_LAST_SAVED_KEY,
        lastSavedAt
      );

      emitBackupStatus({
        fileName: autoBackupHandle.name || backupState.fileName,
        permission: "granted",
        pending: false,
        saving: false,
        lastSavedAt,
        error: ""
      });

      return statusSnapshot();
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

    // The picker is deliberately the first awaited action so it is directly
    // connected to the user's click.
    const handle = await window.showSaveFilePicker({
      id: "mosaic-crochet-backup",
      suggestedName: "mosaic-crochet-library-backup.json",
      types: [
        {
          description: "Mosaic Crochet library backup",
          accept: {
            "application/json": [".json"]
          }
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
    if (!autoBackupHandle) {
      return await enableAutoBackup();
    }

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

    if (!autoBackupEnabled || !autoBackupHandle) {
      return statusSnapshot();
    }

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
      fileName:
        autoBackupHandle?.name ||
        backupState.fileName ||
        ""
    });
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

    if (
      payload?.backupType !== BACKUP_TYPE ||
      !Array.isArray(payload.projects)
    ) {
      throw new Error(
        "This is not a compatible Mosaic Crochet library backup."
      );
    }

    return payload.projects.map(normalizeProject);
  }

  async function restoreBackupFile(file) {
    const projects = parseBackupText(await file.text());
    await replaceAllProjects(projects);

    // If an external auto-backup file is already connected, update it with
    // the restored library as well.
    await flushAutoBackup();

    return projects;
  }

  async function init(starterChart) {
    await openDatabase();
    await loadAutoBackupConfiguration();

    if (starterChart) {
      await seedStarter(starterChart);
    }

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
    updateProgress,
    replaceAllProjects,
    validateChart,
    defaultProgress,
    buildBackupPayload,
    downloadBackup,
    restoreBackupFile,
    enableAutoBackup,
    reconnectAutoBackup,
    chooseNewAutoBackupFile,
    backupNow,
    flushAutoBackup,
    disableAutoBackup,
    getAutoBackupStatus,
    onAutoBackupStatus,
    get mode() {
      return mode;
    }
  };
})();
