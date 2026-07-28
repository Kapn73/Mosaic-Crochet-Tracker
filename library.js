(() => {
  "use strict";

  const DEFAULT_SEGMENT_SIZE = 10;
  const MAX_PDF_FILE_BYTES = 75 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);

  let pendingChart = null;
  let pendingFileName = "";
  let pendingFileType = "";
  let pendingDiagnostics = null;
  let renameProjectId = null;
  let currentBackupStatus = null;
  let selectedRestoreFile = null;
  let selectedRestoreInspection = null;
  let allProjects = [];

  const ui = {
    projectList: $("projectList"),
    projectSearch: $("projectSearch"),
    projectSort: $("projectSort"),
    showArchived: $("showArchived"),
    storageInfo: $("storageInfo"),

    newProjectDialog: $("newProjectDialog"),
    projectFile: $("projectFile"),
    projectName: $("projectName"),
    filePreview: $("filePreview"),
    importPreviewPanel: $("importPreviewPanel"),
    importPreviewCanvas: $("importPreviewCanvas"),
    importerVersion: $("importerVersion"),
    importDiagnostics: $("importDiagnostics"),
    downloadConvertedJson: $("downloadConvertedJson"),
    createProject: $("createProject"),

    renameDialog: $("renameDialog"),
    renameName: $("renameName"),

    backupStatusText: $("backupStatusText"),
    backupFileText: $("backupFileText"),
    autoBackupAction: $("autoBackupAction"),
    backupNow: $("backupNow"),
    disconnectBackup: $("disconnectBackup"),
    undoRestore: $("undoRestore"),
    restoreBackup: $("restoreBackup"),

    restoreDialog: $("restoreDialog"),
    restoreSummary: $("restoreSummary"),
    restoreProjectList: $("restoreProjectList"),
    mergeRestore: $("mergeRestore"),
    replaceRestore: $("replaceRestore")
  };

  function starterChart() {
    return JSON.parse($("embeddedStarterChart").textContent);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function fileKind(file) {
    const name = String(file?.name || "").toLowerCase();
    if (file?.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    if (file?.type === "application/json" || name.endsWith(".json")) return "json";
    return "unknown";
  }

  function chartStitchCounts(chart) {
    const counts = { s: 0, d: 0, b: 0, c: 0 };

    for (const row of chart.rows || []) {
      for (const code of String(row.stitches || "")) {
        if (Object.prototype.hasOwnProperty.call(counts, code)) counts[code] += 1;
      }
    }

    for (const code of String(chart.foundation?.stitches || "")) {
      if (Object.prototype.hasOwnProperty.call(counts, code)) counts[code] += 1;
    }

    return counts;
  }

  function sourceLabel(project) {
    const type = String(project.chart?.source?.type || "").toLowerCase();
    if (type.includes("pdf")) return "Stitch Fiddle PDF";
    if (type.includes("json")) return "JSON";
    if (type.includes("demo")) return "Original demo";
    return project.sourceFileName?.toLowerCase().endsWith(".pdf")
      ? "Stitch Fiddle PDF"
      : "Chart JSON";
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";

    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function formatBackupTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function projectStats(project) {
    const rows = Number(project.chart?.dimensions?.rows) || 0;
    const stitches = Number(project.chart?.dimensions?.stitchesPerRow) || 0;
    const requestedSegmentSize =
      Number(project.progress?.view?.segmentSize) || DEFAULT_SEGMENT_SIZE;
    const segmentSize = Math.max(
      1,
      Math.min(stitches || DEFAULT_SEGMENT_SIZE, Math.round(requestedSegmentSize))
    );
    const total = rows * stitches;
    const completed = Array.isArray(project.progress?.completed)
      ? project.progress.completed.filter(
          (key) => !String(key).startsWith("0:")
        ).length
      : 0;
    const percent = total ? completed / total * 100 : 0;

    return {
      rows,
      stitches,
      total,
      completed,
      percent,
      segmentSize,
      segments: Math.ceil(stitches / segmentSize)
    };
  }

  function appendText(parent, tag, text, className = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function setFilePreview(state, lines) {
    ui.filePreview.className = `file-preview${state ? ` ${state}` : ""}`;
    clearElement(ui.filePreview);

    for (const [index, line] of lines.entries()) {
      if (index > 0) ui.filePreview.appendChild(document.createElement("br"));
      const span = document.createElement(index === 0 ? "strong" : "span");
      span.textContent = line;
      ui.filePreview.appendChild(span);
    }
  }

  function renderBackupStatus(status) {
    currentBackupStatus = status;
    ui.backupStatusText.className = "backup-status-text";
    ui.disconnectBackup.classList.toggle("hidden", !status.enabled);

    if (!status.supported) {
      ui.backupStatusText.classList.add("warning");
      ui.backupStatusText.textContent =
        "Automatic file backup is not supported in this browser. Download Backup and Restore Backup still work.";
      ui.backupFileText.textContent = "";
      ui.autoBackupAction.textContent = "Auto-Backup Unavailable";
      ui.autoBackupAction.disabled = true;
      ui.backupNow.disabled = true;
      return;
    }

    ui.autoBackupAction.disabled = false;

    if (!status.enabled || !status.hasHandle) {
      ui.backupStatusText.textContent = "Auto-backup is not connected yet.";
      ui.backupFileText.textContent =
        "Choose a backup file in iCloud Drive, Google Drive, or another folder.";
      ui.autoBackupAction.textContent = "Enable Auto-Backup";
      ui.backupNow.disabled = true;
      return;
    }

    ui.backupFileText.textContent =
      `${status.fileName || "Selected backup file"}${
        status.lastSavedAt
          ? ` · Last saved ${formatBackupTime(status.lastSavedAt)}`
          : ""
      }`;

    ui.backupNow.disabled = false;

    if (status.saving) {
      ui.backupStatusText.textContent = "Saving the complete project library...";
      ui.autoBackupAction.textContent = "Change Backup File";
      return;
    }

    if (status.pending) {
      ui.backupStatusText.textContent =
        "Project changes are waiting to be backed up.";
      ui.autoBackupAction.textContent = "Change Backup File";
      return;
    }

    if (status.permission !== "granted") {
      ui.backupStatusText.classList.add("warning");
      ui.backupStatusText.textContent =
        "The backup file needs permission before it can be updated.";
      ui.autoBackupAction.textContent = "Reconnect Auto-Backup";
      return;
    }

    if (status.error) {
      ui.backupStatusText.classList.add("warning");
      ui.backupStatusText.textContent = `Backup needs attention: ${status.error}`;
      ui.autoBackupAction.textContent = "Reconnect Auto-Backup";
      return;
    }

    ui.backupStatusText.classList.add("success");
    ui.backupStatusText.textContent =
      status.lastSavedAt
        ? "Auto-backup is connected and current."
        : "Auto-backup is connected.";
    ui.autoBackupAction.textContent = "Change Backup File";
  }

  async function refreshRestoreRecoveryButton() {
    ui.undoRestore.classList.toggle(
      "hidden",
      !(await ProjectStore.hasRestoreRecovery())
    );
  }

  function projectCard(project) {
    const stats = projectStats(project);
    const card = document.createElement("article");
    card.className = `project-card${project.archived ? " archived" : ""}`;

    const content = document.createElement("div");
    const headingRow = document.createElement("div");
    headingRow.className = "project-heading-row";
    appendText(headingRow, "h2", project.name);

    if (project.archived) {
      appendText(headingRow, "span", "Archived", "archive-badge");
    }

    content.appendChild(headingRow);

    const meta = document.createElement("div");
    meta.className = "project-meta";
    appendText(meta, "span", `${stats.rows} rows × ${stats.stitches} stitches`);
    appendText(meta, "span", sourceLabel(project));
    appendText(
      meta,
      "span",
      `${stats.segments} segments per row at ${stats.segmentSize} ${
        stats.segmentSize === 1 ? "stitch" : "stitches"
      } each`
    );
    appendText(meta, "span", `Updated ${formatDate(project.updatedAt)}`);
    content.appendChild(meta);

    const progressLine = document.createElement("div");
    progressLine.className = "progress-line";
    appendText(
      progressLine,
      "span",
      `${stats.completed.toLocaleString()} of ${stats.total.toLocaleString()} stitches`
    );
    appendText(progressLine, "strong", `${stats.percent.toFixed(2)}%`);
    content.appendChild(progressLine);

    const progressTrack = document.createElement("div");
    progressTrack.className = "progress-track";
    const progressBar = document.createElement("div");
    progressBar.className = "progress-bar";
    progressBar.style.width = `${stats.percent}%`;
    progressTrack.appendChild(progressBar);
    content.appendChild(progressTrack);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const addButton = (label, className, handler) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (className) button.className = className;
      button.addEventListener("click", handler);
      actions.appendChild(button);
    };

    addButton("Load Project", "load primary", () => {
      window.location.href =
        `viewer.html?project=${encodeURIComponent(project.id)}`;
    });

    addButton("Rename", "", () => {
      renameProjectId = project.id;
      ui.renameName.value = project.name;
      ui.renameDialog.classList.remove("hidden");
      setTimeout(() => {
        ui.renameName.focus();
        ui.renameName.select();
      }, 0);
    });

    addButton("Duplicate", "", async () => {
      try {
        await ProjectStore.duplicate(project.id, true);
        await renderProjects();
      } catch (error) {
        alert(`Could not duplicate the project: ${error.message}`);
      }
    });

    addButton(project.archived ? "Unarchive" : "Archive", "", async () => {
      try {
        await ProjectStore.setArchived(project.id, !project.archived);
        await renderProjects();
      } catch (error) {
        alert(`Could not update the project: ${error.message}`);
      }
    });

    addButton("Delete", "danger", async () => {
      if (!confirm(`Delete "${project.name}" and all of its saved progress?`)) {
        return;
      }

      await ProjectStore.remove(project.id);
      await renderProjects();
    });

    card.append(content, actions);
    return card;
  }

  function filteredAndSortedProjects() {
    const query = ui.projectSearch.value.trim().toLowerCase();
    const showArchived = ui.showArchived.checked;

    const projects = allProjects.filter((project) => {
      if (project.archived && !showArchived) return false;
      return !query || project.name.toLowerCase().includes(query);
    });

    if (ui.projectSort.value === "name") {
      projects.sort((a, b) => a.name.localeCompare(b.name));
    } else if (ui.projectSort.value === "progress") {
      projects.sort(
        (a, b) => projectStats(b).percent - projectStats(a).percent
      );
    } else {
      projects.sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
      );
    }

    return projects;
  }

  async function renderProjects(reload = true) {
    if (reload) allProjects = await ProjectStore.list();
    const projects = filteredAndSortedProjects();

    clearElement(ui.projectList);

    if (!projects.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      appendText(
        empty,
        "strong",
        allProjects.length ? "No matching projects" : "No projects yet"
      );
      appendText(
        empty,
        "p",
        allProjects.length
          ? "Change the search or archive filter."
          : "Select New Project to import a Stitch Fiddle PDF or compatible JSON."
      );
      ui.projectList.appendChild(empty);
      return;
    }

    for (const project of projects) {
      ui.projectList.appendChild(projectCard(project));
    }
  }

  function resetImportState() {
    pendingChart = null;
    pendingFileName = "";
    pendingFileType = "";
    pendingDiagnostics = null;
    ui.projectFile.value = "";
    ui.projectName.value = "";
    ui.projectFile.disabled = false;
    ui.downloadConvertedJson.classList.add("hidden");
    ui.importPreviewPanel.classList.add("hidden");
    ui.createProject.disabled = true;
    setFilePreview("", ["Select a PDF or JSON file to check it."]);
  }

  function openNewProject() {
    resetImportState();
    ui.newProjectDialog.classList.remove("hidden");
  }

  function closeNewProject() {
    ui.newProjectDialog.classList.add("hidden");
  }

  function importDiagnostics() {
    if (!pendingChart) return null;
    const counts = chartStitchCounts(pendingChart);

    return {
      importerVersion:
        pendingFileType === "pdf"
          ? globalThis.StitchFiddlePDF?.version || "unknown"
          : "JSON",
      fileName: pendingFileName,
      fileType: pendingFileType,
      chartId: pendingChart.chartId,
      title: pendingChart.title,
      rows: pendingChart.dimensions.rows,
      stitchesPerRow: pendingChart.dimensions.stitchesPerRow,
      totalCells:
        pendingChart.dimensions.rows *
        pendingChart.dimensions.stitchesPerRow,
      singleCrochet: counts.s,
      doubleCrochet: counts.d,
      borderStitches: counts.b,
      foundationChains: counts.c,
      palette: Object.fromEntries(
        Object.entries(pendingChart.palette).map(([key, value]) => [
          key,
          { name: value.name, hex: value.hex }
        ])
      ),
      orientation: pendingChart.orientation,
      source: pendingChart.source
    };
  }

  function renderImportDiagnostics() {
    pendingDiagnostics = importDiagnostics();
    ui.importDiagnostics.textContent = pendingDiagnostics
      ? JSON.stringify(pendingDiagnostics, null, 2)
      : "";
  }

  function renderImportPreview() {
    if (!pendingChart) return;

    ui.importPreviewPanel.classList.remove("hidden");
    ui.importerVersion.textContent =
      pendingFileType === "pdf"
        ? `PDF importer v${globalThis.StitchFiddlePDF?.version || "?"}`
        : "Validated JSON";

    const canvas = ui.importPreviewCanvas;
    const context = canvas.getContext("2d", { alpha: false });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = Math.max(
      280,
      Math.min(640, canvas.parentElement.clientWidth || 480)
    );
    const cssHeight = Math.max(220, Math.round(cssWidth * 0.7));

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = false;

    const rows = pendingChart.dimensions.rows;
    const stitches = pendingChart.dimensions.stitchesPerRow;
    const cell = Math.min(cssWidth / stitches, cssHeight / rows);
    const chartWidth = stitches * cell;
    const chartHeight = rows * cell;
    const offsetX = (cssWidth - chartWidth) / 2;
    const offsetY = (cssHeight - chartHeight) / 2;

    context.fillStyle = "#111827";
    context.fillRect(0, 0, cssWidth, cssHeight);

    for (let visualY = 0; visualY < rows; visualY += 1) {
      const rowNumber = rows - visualY;
      const row = pendingChart.rows[rowNumber - 1];

      for (let visualX = 0; visualX < stitches; visualX += 1) {
        const stitchIndex = stitches - visualX - 1;
        const palette =
          pendingChart.palette[row.colors[stitchIndex]] ||
          Object.values(pendingChart.palette)[0];

        context.fillStyle = palette.hex;
        context.fillRect(
          offsetX + visualX * cell,
          offsetY + visualY * cell,
          Math.ceil(cell + 0.2),
          Math.ceil(cell + 0.2)
        );

        if (cell >= 7 && row.stitches[stitchIndex] === "d") {
          context.strokeStyle =
            palette.rgb.reduce((sum, value) => sum + value, 0) > 400
              ? "rgba(0,0,0,.75)"
              : "rgba(255,255,255,.85)";
          context.lineWidth = Math.max(1, cell * 0.13);
          const x = offsetX + visualX * cell;
          const y = offsetY + visualY * cell;
          context.beginPath();
          context.moveTo(x + cell * 0.24, y + cell * 0.24);
          context.lineTo(x + cell * 0.76, y + cell * 0.76);
          context.moveTo(x + cell * 0.76, y + cell * 0.24);
          context.lineTo(x + cell * 0.24, y + cell * 0.76);
          context.stroke();
        }
      }
    }

    renderImportDiagnostics();
  }

  function flipPendingChart() {
    if (!pendingChart) return;

    for (const row of pendingChart.rows) {
      row.colors = [...row.colors].reverse().join("");
      row.stitches = [...row.stitches].reverse().join("");
    }

    pendingChart.binaryRows = pendingChart.rows.map((row) => row.colors);
    pendingChart.foundation.colors =
      [...pendingChart.foundation.colors].reverse().join("");
    pendingChart.foundation.stitches =
      [...pendingChart.foundation.stitches].reverse().join("");

    pendingChart.source = {
      ...(pendingChart.source || {}),
      manualHorizontalFlip:
        pendingChart.source?.manualHorizontalFlip === true ? false : true
    };

    pendingChart = ProjectStore.validateChart(pendingChart);
    renderImportPreview();
  }

  function swapPendingColors() {
    if (!pendingChart) return;
    if (!pendingChart.palette["0"] || !pendingChart.palette["1"]) {
      alert("Color swapping currently requires palette keys 0 and 1.");
      return;
    }

    const first = clone(pendingChart.palette["0"]);
    const second = clone(pendingChart.palette["1"]);
    pendingChart.palette["0"] = { ...second, id: 0 };
    pendingChart.palette["1"] = { ...first, id: 1 };

    pendingChart.source = {
      ...(pendingChart.source || {}),
      manualColorSwap:
        pendingChart.source?.manualColorSwap === true ? false : true
    };

    pendingChart = ProjectStore.validateChart(pendingChart);
    renderImportPreview();
  }

  function copyDiagnostics() {
    const text = ui.importDiagnostics.textContent;
    if (!text) return;

    const fallback = () => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else {
      fallback();
    }

    setFilePreview("valid", ["Diagnostics copied.", "The chart remains ready to import."]);
  }

  function downloadPendingJson() {
    if (!pendingChart) return;

    const blob = new Blob(
      [JSON.stringify(pendingChart, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName = String(
      ui.projectName.value ||
      pendingChart.title ||
      "stitch-fiddle-chart"
    )
      .trim()
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "stitch-fiddle-chart";

    anchor.href = url;
    anchor.download = `${safeName}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function inspectFile(file) {
    pendingChart = null;
    pendingFileName = file.name;
    pendingFileType = fileKind(file);
    pendingDiagnostics = null;
    ui.downloadConvertedJson.classList.add("hidden");
    ui.importPreviewPanel.classList.add("hidden");
    ui.createProject.disabled = true;

    if (pendingFileType === "unknown") {
      setFilePreview("invalid", [
        "This file type is not supported.",
        "Choose a .pdf or .json file."
      ]);
      return;
    }

    if (
      pendingFileType === "json" &&
      file.size > ProjectStore.limits.maxJsonFileBytes
    ) {
      setFilePreview("invalid", [
        "This JSON file is too large.",
        `The current limit is ${Math.round(
          ProjectStore.limits.maxJsonFileBytes / 1024 / 1024
        )} MB.`
      ]);
      return;
    }

    if (pendingFileType === "pdf" && file.size > MAX_PDF_FILE_BYTES) {
      setFilePreview("invalid", [
        "This PDF is too large.",
        `The current PDF file limit is ${Math.round(
          MAX_PDF_FILE_BYTES / 1024 / 1024
        )} MB.`
      ]);
      return;
    }

    try {
      let parsed;

      if (pendingFileType === "pdf") {
        if (!globalThis.StitchFiddlePDF?.parse) {
          throw new Error("The Stitch Fiddle PDF importer did not load.");
        }

        ui.filePreview.className = "file-preview processing";
        clearElement(ui.filePreview);
        const spinner = document.createElement("span");
        spinner.className = "processing-spinner";
        spinner.setAttribute("aria-hidden", "true");
        ui.filePreview.appendChild(spinner);
        appendText(ui.filePreview, "strong", "Reading Stitch Fiddle PDF…");
        ui.filePreview.appendChild(document.createElement("br"));
        const message = appendText(
          ui.filePreview,
          "span",
          "The file stays on this device."
        );
        message.id = "pdfImportMessage";

        ui.projectFile.disabled = true;
        await nextPaint();

        parsed = await StitchFiddlePDF.parse(file, {
          fileName: file.name,
          onProgress(progress) {
            const progressMessage = $("pdfImportMessage");
            if (progressMessage) progressMessage.textContent = progress.message;
          }
        });
      } else {
        parsed = JSON.parse(await file.text());
      }

      pendingChart = ProjectStore.validateChart(parsed);
      const rows = pendingChart.dimensions.rows;
      const stitches = pendingChart.dimensions.stitchesPerRow;
      const counts = chartStitchCounts(pendingChart);
      const source =
        pendingFileType === "pdf"
          ? "Stitch Fiddle PDF converted successfully"
          : "Compatible JSON chart";

      if (!ui.projectName.value.trim()) {
        ui.projectName.value =
          pendingChart.title ||
          file.name.replace(/\.(?:pdf|json)$/i, "");
      }

      setFilePreview("valid", [
        source,
        pendingChart.title,
        `${rows.toLocaleString()} rows × ${stitches.toLocaleString()} stitches · ${(rows * stitches).toLocaleString()} chart cells`,
        `${counts.d.toLocaleString()} double crochet · ${counts.s.toLocaleString()} single crochet · ${counts.b.toLocaleString()} border stitches`,
        pendingFileType === "pdf"
          ? "Converted locally. The PDF is not uploaded or added to GitHub."
          : "Every palette key, stitch code, row number, and string length passed validation."
      ]);

      ui.downloadConvertedJson.classList.toggle(
        "hidden",
        pendingFileType !== "pdf"
      );
      ui.createProject.disabled = !ui.projectName.value.trim();
      renderImportPreview();
    } catch (error) {
      console.error(error);
      const errorCode = error?.code ? `Error code: ${error.code}` : "";
      setFilePreview("invalid", [
        `This file cannot be imported: ${error.message}`,
        errorCode
      ].filter(Boolean));

      pendingDiagnostics = {
        importerVersion: globalThis.StitchFiddlePDF?.version || "unknown",
        fileName: file.name,
        fileType: pendingFileType,
        errorCode: error?.code || "IMPORT_ERROR",
        errorMessage: error?.message || String(error)
      };
      ui.importDiagnostics.textContent =
        JSON.stringify(pendingDiagnostics, null, 2);
    } finally {
      ui.projectFile.disabled = false;
    }
  }

  async function createProject() {
    const name = ui.projectName.value.trim();

    if (!pendingChart) {
      alert("Choose a compatible Stitch Fiddle PDF or chart JSON file.");
      return;
    }

    if (!name) {
      alert("Enter a project name.");
      ui.projectName.focus();
      return;
    }

    const project = await ProjectStore.create(
      name,
      pendingChart,
      pendingFileName
    );

    await ProjectStore.flushAutoBackup();

    window.location.href =
      `viewer.html?project=${encodeURIComponent(project.id)}`;
  }

  function closeRename() {
    renameProjectId = null;
    ui.renameDialog.classList.add("hidden");
  }

  async function saveRename() {
    const name = ui.renameName.value.trim();

    if (!renameProjectId || !name) {
      alert("Enter a project name.");
      return;
    }

    await ProjectStore.rename(renameProjectId, name);
    closeRename();
    await renderProjects();
  }

  async function handleAutoBackupAction() {
    try {
      if (
        currentBackupStatus?.enabled &&
        currentBackupStatus?.hasHandle &&
        currentBackupStatus?.permission !== "granted"
      ) {
        await ProjectStore.reconnectAutoBackup();
      } else {
        await ProjectStore.chooseNewAutoBackupFile();
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      alert(`Could not set up auto-backup: ${error.message}`);
    }
  }

  async function handleBackupNow() {
    try {
      await ProjectStore.backupNow();
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      alert(`Could not write the backup: ${error.message}`);
    }
  }

  function closeRestoreDialog() {
    selectedRestoreFile = null;
    selectedRestoreInspection = null;
    ui.restoreDialog.classList.add("hidden");
  }

  async function inspectRestoreBackup(file) {
    selectedRestoreFile = file;
    selectedRestoreInspection = await ProjectStore.inspectBackupFile(file);

    clearElement(ui.restoreProjectList);
    const summary = selectedRestoreInspection.summary;
    ui.restoreSummary.textContent =
      `${summary.projectCount} ${
        summary.projectCount === 1 ? "project" : "projects"
      } found${
        summary.exportedAt
          ? ` · Backup created ${formatDate(summary.exportedAt)}`
          : ""
      }.`;

    for (const project of summary.projects) {
      const item = document.createElement("div");
      item.className = "restore-project-item";
      appendText(item, "strong", project.name);
      appendText(
        item,
        "span",
        `${project.rows} rows × ${project.stitchesPerRow} stitches · ${project.percent.toFixed(1)}% complete`
      );
      ui.restoreProjectList.appendChild(item);
    }

    ui.restoreDialog.classList.remove("hidden");
  }

  async function performRestore(mode) {
    if (!selectedRestoreFile) return;

    ui.mergeRestore.disabled = true;
    ui.replaceRestore.disabled = true;

    try {
      const result = await ProjectStore.restoreBackupFile(
        selectedRestoreFile,
        mode
      );
      closeRestoreDialog();
      await renderProjects();
      await refreshRestoreRecoveryButton();

      alert(
        `${mode === "merge" ? "Imported" : "Restored"} ${
          result.projects.length
        } ${result.projects.length === 1 ? "project" : "projects"}.`
      );
    } catch (error) {
      console.error(error);
      alert(`Could not restore the backup: ${error.message}`);
    } finally {
      ui.mergeRestore.disabled = false;
      ui.replaceRestore.disabled = false;
    }
  }

  function bindEvents() {
    $("newProject").addEventListener("click", openNewProject);
    $("closeNewProject").addEventListener("click", closeNewProject);
    $("cancelNewProject").addEventListener("click", closeNewProject);

    ui.projectFile.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await inspectFile(file);
    });

    ui.downloadConvertedJson.addEventListener("click", downloadPendingJson);
    $("flipImport").addEventListener("click", flipPendingChart);
    $("swapImportColors").addEventListener("click", swapPendingColors);
    $("copyDiagnostics").addEventListener("click", copyDiagnostics);

    ui.projectName.addEventListener("input", () => {
      ui.createProject.disabled =
        !pendingChart || !ui.projectName.value.trim();
    });

    ui.createProject.addEventListener("click", () => {
      createProject().catch((error) => {
        console.error(error);
        alert(`Could not create the project: ${error.message}`);
      });
    });

    $("cancelRename").addEventListener("click", closeRename);
    $("saveRename").addEventListener("click", () => {
      saveRename().catch((error) => {
        console.error(error);
        alert(`Could not rename the project: ${error.message}`);
      });
    });

    ui.renameName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        $("saveRename").click();
      }
    });

    ui.projectSearch.addEventListener("input", () => renderProjects(false));
    ui.projectSort.addEventListener("change", () => renderProjects(false));
    ui.showArchived.addEventListener("change", () => renderProjects(false));

    ui.autoBackupAction.addEventListener("click", handleAutoBackupAction);
    ui.backupNow.addEventListener("click", handleBackupNow);

    $("downloadBackup").addEventListener("click", () => {
      ProjectStore.downloadBackup().catch((error) => {
        console.error(error);
        alert(`Could not download the backup: ${error.message}`);
      });
    });

    ui.restoreBackup.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      try {
        await inspectRestoreBackup(file);
      } catch (error) {
        console.error(error);
        alert(`Could not inspect the backup: ${error.message}`);
      }
    });

    $("closeRestoreDialog").addEventListener("click", closeRestoreDialog);
    $("cancelRestore").addEventListener("click", closeRestoreDialog);
    ui.mergeRestore.addEventListener("click", () => performRestore("merge"));
    ui.replaceRestore.addEventListener("click", () => performRestore("replace"));

    ui.undoRestore.addEventListener("click", async () => {
      if (!confirm("Swap the current library with the recovery copy saved before the last restore?")) {
        return;
      }

      try {
        await ProjectStore.restorePreviousLibrary();
        await renderProjects();
        await refreshRestoreRecoveryButton();
        alert("The previous library was restored. The library you just replaced is now the recovery copy.");
      } catch (error) {
        alert(`Could not restore the previous library: ${error.message}`);
      }
    });

    ui.disconnectBackup.addEventListener("click", async () => {
      if (!confirm(
        "Disconnect automatic backup? The existing backup file will not be deleted."
      )) {
        return;
      }

      await ProjectStore.disableAutoBackup();
    });

    window.addEventListener("resize", () => {
      if (pendingChart && !ui.importPreviewPanel.classList.contains("hidden")) {
        renderImportPreview();
      }
    });
  }

  async function init() {
    try {
      await ProjectStore.init(starterChart());

      ui.storageInfo.textContent =
        ProjectStore.mode === "indexeddb"
          ? "Charts and compact progress records are stored separately in this browser. External backups protect the library if browser data is cleared."
          : "Projects are stored in this browser using localStorage. Downloaded backups remain available.";

      ProjectStore.onAutoBackupStatus(renderBackupStatus);
      bindEvents();
      await renderProjects();
      await ProjectStore.getAutoBackupStatus();
      await refreshRestoreRecoveryButton();

      const params = new URLSearchParams(window.location.search);
      if (params.get("new") === "1") openNewProject();
    } catch (error) {
      console.error(error);
      clearElement(ui.projectList);
      appendText(
        ui.projectList,
        "p",
        `Could not load projects: ${error.message}`,
        "empty-state"
      );
    }
  }

  init();
})();
