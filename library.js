(() => {
  "use strict";

  const DEFAULT_SEGMENT_SIZE = 10;
  const $ = (id) => document.getElementById(id);

  let pendingChart = null;
  let pendingFileName = "";
  let pendingFileType = "";
  let renameProjectId = null;
  let currentBackupStatus = null;

  const ui = {
    projectList: $("projectList"),
    storageInfo: $("storageInfo"),
    newProjectDialog: $("newProjectDialog"),
    projectFile: $("projectFile"),
    projectName: $("projectName"),
    filePreview: $("filePreview"),
    downloadConvertedJson: $("downloadConvertedJson"),
    createProject: $("createProject"),
    renameDialog: $("renameDialog"),
    renameName: $("renameName"),
    backupStatusText: $("backupStatusText"),
    backupFileText: $("backupFileText"),
    autoBackupAction: $("autoBackupAction"),
    backupNow: $("backupNow"),
    disconnectBackup: $("disconnectBackup"),
    restoreBackup: $("restoreBackup")
  };

  function starterChart() {
    return JSON.parse($("embeddedStarterChart").textContent);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function downloadPendingJson() {
    if (!pendingChart) return;

    const blob = new Blob(
      [JSON.stringify(pendingChart, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName = String(ui.projectName.value || pendingChart.title || "stitch-fiddle-chart")
      .trim()
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "stitch-fiddle-chart";

    anchor.href = url;
    anchor.download = `${safeName}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function projectStats(project) {
    const rows = Number(project.chart?.dimensions?.rows) || 0;
    const stitches = Number(project.chart?.dimensions?.stitchesPerRow) || 0;
    const requestedSegmentSize =
      Number(project.progress?.view?.segmentSize) || DEFAULT_SEGMENT_SIZE;

    const segmentSize = Math.max(
      1,
      Math.min(
        stitches || DEFAULT_SEGMENT_SIZE,
        Math.round(requestedSegmentSize)
      )
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
      ui.backupStatusText.textContent =
        "Auto-backup is not connected yet.";
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
      ui.backupStatusText.textContent =
        `Backup needs attention: ${status.error}`;
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

  async function renderProjects() {
    const projects = await ProjectStore.list();
    ui.projectList.innerHTML = "";

    if (!projects.length) {
      ui.projectList.innerHTML = `
        <div class="empty-state">
          <strong>No projects yet</strong>
          <p>Click New Project to import a Stitch Fiddle PDF or compatible JSON.</p>
        </div>
      `;
      return;
    }

    for (const project of projects) {
      const stats = projectStats(project);
      const card = document.createElement("article");
      card.className = "project-card";

      card.innerHTML = `
        <div>
          <h2>${escapeHtml(project.name)}</h2>
          <div class="project-meta">
            <span>${stats.rows} rows × ${stats.stitches} stitches</span>
            <span>${escapeHtml(sourceLabel(project))}</span>
            <span>${stats.segments} segments per row at ${stats.segmentSize} ${stats.segmentSize === 1 ? "stitch" : "stitches"} each</span>
            <span>Updated ${escapeHtml(formatDate(project.updatedAt))}</span>
          </div>
          <div class="progress-line">
            <span>${stats.completed.toLocaleString()} of ${stats.total.toLocaleString()} stitches</span>
            <strong>${stats.percent.toFixed(2)}%</strong>
          </div>
          <div class="progress-track">
            <div class="progress-bar" style="width:${stats.percent}%"></div>
          </div>
        </div>

        <div class="card-actions">
          <button class="load primary" type="button">Load Project</button>
          <button class="rename" type="button">Rename</button>
          <button class="delete danger" type="button">Delete</button>
        </div>
      `;

      card.querySelector(".load").addEventListener("click", () => {
        window.location.href =
          `viewer.html?project=${encodeURIComponent(project.id)}`;
      });

      card.querySelector(".rename").addEventListener("click", () => {
        renameProjectId = project.id;
        ui.renameName.value = project.name;
        ui.renameDialog.classList.remove("hidden");

        setTimeout(() => {
          ui.renameName.focus();
          ui.renameName.select();
        }, 0);
      });

      card.querySelector(".delete").addEventListener("click", async () => {
        const confirmed = confirm(
          `Delete "${project.name}" and all of its saved progress?`
        );

        if (!confirmed) return;

        await ProjectStore.remove(project.id);
        await renderProjects();
      });

      ui.projectList.appendChild(card);
    }
  }

  function openNewProject() {
    pendingChart = null;
    pendingFileName = "";
    pendingFileType = "";
    ui.projectFile.value = "";
    ui.projectName.value = "";
    ui.projectFile.disabled = false;
    ui.filePreview.className = "file-preview";
    ui.filePreview.textContent = "Select a Stitch Fiddle PDF or compatible JSON file to check it.";
    ui.downloadConvertedJson.classList.add("hidden");
    ui.createProject.disabled = true;
    ui.newProjectDialog.classList.remove("hidden");
  }

  function closeNewProject() {
    ui.newProjectDialog.classList.add("hidden");
  }

  async function inspectFile(file) {
    pendingChart = null;
    pendingFileName = file.name;
    pendingFileType = fileKind(file);
    ui.createProject.disabled = true;
    ui.downloadConvertedJson.classList.add("hidden");

    if (pendingFileType === "unknown") {
      ui.filePreview.className = "file-preview invalid";
      ui.filePreview.textContent = "Choose a .pdf Stitch Fiddle export or a compatible .json chart file.";
      return;
    }

    try {
      let parsed;

      if (pendingFileType === "pdf") {
        if (!globalThis.StitchFiddlePDF?.parse) {
          throw new Error("The Stitch Fiddle PDF importer did not load.");
        }

        ui.filePreview.className = "file-preview processing";
        ui.filePreview.innerHTML = `
          <span class="processing-spinner" aria-hidden="true"></span>
          <strong>Reading Stitch Fiddle PDF…</strong><br>
          <span id="pdfImportMessage">The file stays on this device.</span>
        `;
        ui.projectFile.disabled = true;
        await nextPaint();

        parsed = await StitchFiddlePDF.parse(file, {
          fileName: file.name,
          onProgress(progress) {
            const message = $("pdfImportMessage");
            if (message) message.textContent = progress.message;
          }
        });
      } else {
        parsed = JSON.parse(await file.text());
      }

      pendingChart = ProjectStore.validateChart(parsed);
      const rows = pendingChart.dimensions.rows;
      const stitches = pendingChart.dimensions.stitchesPerRow;
      const counts = chartStitchCounts(pendingChart);
      const source = pendingFileType === "pdf"
        ? "Stitch Fiddle PDF converted successfully"
        : "Compatible JSON chart";

      if (!ui.projectName.value.trim()) {
        ui.projectName.value = pendingChart.title || file.name.replace(/\.(?:pdf|json)$/i, "");
      }

      const privacyLine = pendingFileType === "pdf"
        ? '<br><span class="privacy-note">Converted locally. The PDF is not uploaded or added to GitHub.</span>'
        : "";

      ui.filePreview.className = "file-preview valid";
      ui.filePreview.innerHTML = `
        <strong>${escapeHtml(source)}</strong><br>
        ${escapeHtml(pendingChart.title)}<br>
        ${rows.toLocaleString()} rows × ${stitches.toLocaleString()} stitches
        · ${(rows * stitches).toLocaleString()} chart cells<br>
        ${counts.d.toLocaleString()} double crochet
        · ${counts.s.toLocaleString()} single crochet
        · ${counts.b.toLocaleString()} border stitches<br>
        Starts at ${Math.min(DEFAULT_SEGMENT_SIZE, stitches)}
        ${Math.min(DEFAULT_SEGMENT_SIZE, stitches) === 1 ? "stitch" : "stitches"} per segment
        ${privacyLine}
      `;

      ui.downloadConvertedJson.classList.toggle("hidden", pendingFileType !== "pdf");
      ui.createProject.disabled = !ui.projectName.value.trim();
    } catch (error) {
      console.error(error);
      ui.filePreview.className = "file-preview invalid";
      ui.filePreview.textContent = `This file cannot be imported: ${error.message}`;
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

    // Do not leave the page before a connected backup has a chance to update.
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

  async function handleRestoreBackup(file) {
    const confirmed = confirm(
      "Restore this backup and replace every project currently stored in the viewer?"
    );

    if (!confirmed) return;

    try {
      const projects = await ProjectStore.restoreBackupFile(file);
      await renderProjects();

      alert(
        `Restored ${projects.length} ${
          projects.length === 1 ? "project" : "projects"
        }.`
      );
    } catch (error) {
      console.error(error);
      alert(`Could not restore the backup: ${error.message}`);
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

    ui.autoBackupAction.addEventListener(
      "click",
      handleAutoBackupAction
    );

    ui.backupNow.addEventListener(
      "click",
      handleBackupNow
    );

    $("downloadBackup").addEventListener("click", () => {
      ProjectStore.downloadBackup().catch((error) => {
        console.error(error);
        alert(`Could not download the backup: ${error.message}`);
      });
    });

    ui.restoreBackup.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];

      if (file) {
        await handleRestoreBackup(file);
      }

      event.target.value = "";
    });

    ui.disconnectBackup.addEventListener("click", async () => {
      const confirmed = confirm(
        "Disconnect automatic backup? The existing backup file will not be deleted."
      );

      if (!confirmed) return;

      await ProjectStore.disableAutoBackup();
    });
  }

  async function init() {
    try {
      await ProjectStore.init(starterChart());

      ui.storageInfo.textContent =
        ProjectStore.mode === "indexeddb"
          ? "Projects are stored in this browser using IndexedDB. The external backup file protects them if browser data is cleared."
          : "Projects are stored in this browser using localStorage. Downloaded backups remain available.";

      ProjectStore.onAutoBackupStatus(renderBackupStatus);

      bindEvents();
      await renderProjects();
      await ProjectStore.getAutoBackupStatus();

      const params = new URLSearchParams(window.location.search);
      if (params.get("new") === "1") openNewProject();
    } catch (error) {
      console.error(error);
      ui.projectList.innerHTML =
        `<p class="empty-state">Could not load projects: ${escapeHtml(error.message)}</p>`;
    }
  }

  init();
})();
