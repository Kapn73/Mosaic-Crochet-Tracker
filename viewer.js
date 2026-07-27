(() => {
  "use strict";

  const DEFAULT_SEGMENT_SIZE = 10;
  const MIN_CELL_SIZE = 4;
  const MAX_CELL_SIZE = 120;
  const MAX_DPR = 2.5;

  const $ = (id) => document.getElementById(id);
  const canvas = $("chartCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const viewport = $("chartViewport");
  const stage = $("chartStage");

  let activeProject = null;
  let chart = null;
  let rowsByNumber = new Map();
  let completed = new Set();
  let currentRow = 1;
  let currentSegment = 1;
  let segmentSize = DEFAULT_SEGMENT_SIZE;
  let cellSize = 44;
  let showFoundation = false;
  let drawQueued = false;
  let saveTimer = null;
  let lastCanvasCssWidth = 0;
  let lastCanvasCssHeight = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  let currentBackupStatus = null;

  const ui = {
    projectName: $("projectName"),
    chartSummary: $("chartSummary"),
    status: $("status"),
    hoverInfo: $("hoverInfo"),
    focusLabel: $("focusLabel"),
    currentRow: $("currentRow"),
    currentSegment: $("currentSegment"),
    segmentTotal: $("segmentTotal"),
    segmentRange: $("segmentRange"),
    detailSegmentRange: $("detailSegmentRange"),
    detailSegmentSize: $("detailSegmentSize"),
    segmentSizeInput: $("segmentSizeInput"),
    segmentSizeStatus: $("segmentSizeStatus"),
    jumpRow: $("jumpRow"),
    jumpSegment: $("jumpSegment"),
    workingColor: $("workingColor"),
    workingColorSwatch: $("workingColorSwatch"),
    singleCount: $("singleCount"),
    doubleCount: $("doubleCount"),
    borderCount: $("borderCount"),
    segmentCompleted: $("segmentCompleted"),
    segmentProgressBar: $("segmentProgressBar"),
    rowPercent: $("rowPercent"),
    completedCount: $("completedCount"),
    totalCount: $("totalCount"),
    overallPercent: $("overallPercent"),
    progressBar: $("progressBar"),
    cellSize: $("cellSize"),
    cellSizeValue: $("cellSizeValue"),
    retinaInfo: $("retinaInfo"),
    focusSegment: $("focusSegment"),
    showGrid: $("showGrid"),
    showSymbols: $("showSymbols"),
    showFoundation: $("showFoundation"),
    colorLegend: $("colorLegend"),
    backupStatusChip: $("backupStatusChip")
  };

  function embeddedData() {
    return JSON.parse($("embeddedChartData").textContent);
  }

  async function loadProjectChart() {
    await ProjectStore.init(embeddedData());

    const projectId = new URLSearchParams(window.location.search).get("project");
    if (!projectId) {
      window.location.href = "index.html";
      throw new Error("No project was selected.");
    }

    activeProject = await ProjectStore.get(projectId);
    if (!activeProject) {
      window.location.href = "index.html";
      throw new Error("The selected project could not be found.");
    }

    return activeProject.chart;
  }

  function validateChart(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Chart data is missing.");
    }

    const rows = data.dimensions?.rows;
    const stitches = data.dimensions?.stitchesPerRow;

    if (!Number.isInteger(rows) || !Number.isInteger(stitches)) {
      throw new Error("Chart dimensions are invalid.");
    }

    if (!Array.isArray(data.rows) || data.rows.length !== rows) {
      throw new Error("Chart rows are incomplete.");
    }

    for (const row of data.rows) {
      if (row.colors?.length !== stitches || row.stitches?.length !== stitches) {
        throw new Error(`Row ${row.number} has invalid data length.`);
      }
    }

    return data;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getRow(rowNumber) {
    return rowsByNumber.get(rowNumber);
  }

  function segmentCount() {
    return Math.ceil(chart.dimensions.stitchesPerRow / segmentSize);
  }

  function segmentBounds(segmentNumber) {
    const segment = clamp(segmentNumber, 1, segmentCount());
    const start = (segment - 1) * segmentSize + 1;
    const end = Math.min(start + segmentSize - 1, chart.dimensions.stitchesPerRow);
    return { start, end, count: end - start + 1 };
  }

  function segmentForStitch(stitchNumber) {
    return Math.floor((stitchNumber - 1) / segmentSize) + 1;
  }

  function cellKey(row, stitch) {
    return `${row}:${stitch}`;
  }

  function sanitizeSegmentSize(value) {
    const numericValue = Number(value);
    const roundedValue = Number.isFinite(numericValue)
      ? Math.round(numericValue)
      : DEFAULT_SEGMENT_SIZE;

    return clamp(
      roundedValue,
      1,
      chart.dimensions.stitchesPerRow
    );
  }

  function applySegmentSizeChange(nextSize, announce = false) {
    const anchorStitch = chart ? segmentBounds(currentSegment).start : 1;
    segmentSize = sanitizeSegmentSize(nextSize);
    ui.segmentSizeInput.max = String(chart.dimensions.stitchesPerRow);
    ui.segmentSizeInput.value = String(segmentSize);
    currentSegment = clamp(segmentForStitch(anchorStitch), 1, segmentCount());
    ui.jumpSegment.max = String(segmentCount());
    updateStageSize();
    updateUi();
    queueDraw();
    saveProgress();
    if (announce) ui.status.textContent = `Segment size set to ${segmentSize}`;
    requestAnimationFrame(() => {
      scrollToCurrentSegment("auto");
    });
  }

  function progressStorageKey() {
    return `crochet-chart-progress:${chart.chartId || "mosaic-chart"}`;
  }

  function displayRowCount() {
    return chart.dimensions.rows + (showFoundation ? 1 : 0);
  }

  function displayYForRow(rowNumber) {
    return chart.dimensions.rows - rowNumber;
  }

  function displayXForStitch(stitchNumber) {
    return chart.dimensions.stitchesPerRow - stitchNumber;
  }

  function rowFromDisplayY(displayY) {
    if (showFoundation && displayY === chart.dimensions.rows) return 0;
    return chart.dimensions.rows - displayY;
  }

  function stitchFromDisplayX(displayX) {
    return chart.dimensions.stitchesPerRow - displayX;
  }

  function currentSegmentRectangle() {
    const bounds = segmentBounds(currentSegment);
    return {
      x: displayXForStitch(bounds.end) * cellSize,
      y: displayYForRow(currentRow) * cellSize,
      width: bounds.count * cellSize,
      height: cellSize
    };
  }

  function updateStageSize() {
    stage.style.width = `${chart.dimensions.stitchesPerRow * cellSize}px`;
    stage.style.height = `${displayRowCount() * cellSize}px`;
  }

  function queueDraw() {
    if (drawQueued) return;

    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      drawVisibleChart();
    });
  }

  function resizeViewportCanvas(cssWidth, cssHeight) {
    const width = Math.max(1, Math.ceil(cssWidth));
    const height = Math.max(1, Math.ceil(cssHeight));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (
      canvas.width !== pixelWidth ||
      canvas.height !== pixelHeight ||
      lastCanvasCssWidth !== width ||
      lastCanvasCssHeight !== height
    ) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      lastCanvasCssWidth = width;
      lastCanvasCssHeight = height;
    }

    canvas.style.left = `${viewport.scrollLeft}px`;
    canvas.style.top = `${viewport.scrollTop}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function symbolColorFor(palette) {
    const rgb = palette.rgb;
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    return brightness > 145
      ? "rgba(0,0,0,0.76)"
      : "rgba(255,255,255,0.88)";
  }

  function drawCell(localX, localY, colorId, stitchCode, rowNumber, stitchNumber) {
    const size = cellSize;
    const palette = chart.palette[String(colorId)];

    ctx.fillStyle = palette.hex;
    ctx.fillRect(localX, localY, size, size);

    if (completed.has(cellKey(rowNumber, stitchNumber))) {
      ctx.fillStyle = "rgba(34, 197, 94, 0.54)";
      ctx.fillRect(localX, localY, size, size);

      if (size >= 10) {
        ctx.strokeStyle = "rgba(255,255,255,0.96)";
        ctx.lineWidth = Math.max(1.25, size * 0.055);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(localX + size * 0.20, localY + size * 0.54);
        ctx.lineTo(localX + size * 0.42, localY + size * 0.75);
        ctx.lineTo(localX + size * 0.81, localY + size * 0.27);
        ctx.stroke();
      }
    }

    if (!ui.showSymbols.checked || size < 7) return;

    const symbolColor = symbolColorFor(palette);

    // Blank means single crochet. Only X cells are double crochet.
    if (stitchCode === "d") {
      const inset = size * 0.21;
      ctx.strokeStyle = symbolColor;
      ctx.lineWidth = Math.max(1.15, size * 0.07);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(localX + inset, localY + inset);
      ctx.lineTo(localX + size - inset, localY + size - inset);
      ctx.moveTo(localX + size - inset, localY + inset);
      ctx.lineTo(localX + inset, localY + size - inset);
      ctx.stroke();
    } else if (stitchCode === "b" && size >= 14) {
      ctx.fillStyle = symbolColor;
      ctx.font = `600 ${Math.max(7, size * 0.30)}px ui-sans-serif, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("BS", localX + size / 2, localY + size / 2);
    } else if (stitchCode === "c") {
      ctx.strokeStyle = symbolColor;
      ctx.lineWidth = Math.max(1, size * 0.055);
      ctx.beginPath();
      ctx.ellipse(
        localX + size / 2,
        localY + size / 2,
        size * 0.34,
        size * 0.19,
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
  }

  function drawDimOverlay(viewLeft, viewTop, width, height) {
    if (!ui.focusSegment.checked) return;

    const rect = currentSegmentRectangle();
    const local = {
      x: rect.x - viewLeft,
      y: rect.y - viewTop,
      width: rect.width,
      height: rect.height
    };

    ctx.fillStyle = "rgba(5, 10, 18, 0.76)";

    const intersects =
      local.x < width &&
      local.x + local.width > 0 &&
      local.y < height &&
      local.y + local.height > 0;

    if (!intersects) {
      ctx.fillRect(0, 0, width, height);
      return;
    }

    const top = clamp(local.y, 0, height);
    const bottom = clamp(local.y + local.height, 0, height);
    const left = clamp(local.x, 0, width);
    const right = clamp(local.x + local.width, 0, width);

    if (top > 0) ctx.fillRect(0, 0, width, top);
    if (bottom < height) ctx.fillRect(0, bottom, width, height - bottom);
    if (left > 0 && bottom > top) ctx.fillRect(0, top, left, bottom - top);
    if (right < width && bottom > top) {
      ctx.fillRect(right, top, width - right, bottom - top);
    }
  }

  function drawGrid(viewLeft, viewTop, width, height, firstX, lastX, firstY, lastY) {
    if (!ui.showGrid.checked || cellSize < 3) return;

    ctx.strokeStyle =
      cellSize >= 18
        ? "rgba(255,255,255,0.34)"
        : "rgba(255,255,255,0.23)";
    ctx.lineWidth = cellSize >= 24 ? 1 : 0.7;
    ctx.beginPath();

    for (let x = firstX; x <= lastX + 1; x += 1) {
      const localX = x * cellSize - viewLeft;
      ctx.moveTo(localX, 0);
      ctx.lineTo(localX, height);
    }

    for (let y = firstY; y <= lastY + 1; y += 1) {
      const localY = y * cellSize - viewTop;
      ctx.moveTo(0, localY);
      ctx.lineTo(width, localY);
    }

    ctx.stroke();
  }

  function drawSegmentOutline(viewLeft, viewTop) {
    const rect = currentSegmentRectangle();
    const x = rect.x - viewLeft;
    const y = rect.y - viewTop;

    ctx.strokeStyle = "#ffb703";
    ctx.lineWidth = Math.max(2.5, Math.min(5, cellSize * 0.10));
    ctx.strokeRect(
      x + ctx.lineWidth / 2,
      y + ctx.lineWidth / 2,
      Math.max(1, rect.width - ctx.lineWidth),
      Math.max(1, rect.height - ctx.lineWidth)
    );

    if (cellSize >= 18) {
      ctx.strokeStyle = "rgba(255,255,255,0.96)";
      ctx.lineWidth = Math.max(1, cellSize * 0.035);
      ctx.beginPath();
      ctx.moveTo(x + 1, y);
      ctx.lineTo(x + 1, y + rect.height);
      ctx.moveTo(x + rect.width - 1, y);
      ctx.lineTo(x + rect.width - 1, y + rect.height);
      ctx.stroke();
    }
  }

  function drawVisibleChart() {
    if (!chart) return;

    const cssWidth = viewport.clientWidth;
    const cssHeight = viewport.clientHeight;

    if (cssWidth <= 0 || cssHeight <= 0) return;

    updateStageSize();
    resizeViewportCanvas(cssWidth, cssHeight);

    const viewLeft = viewport.scrollLeft;
    const viewTop = viewport.scrollTop;
    const columns = chart.dimensions.stitchesPerRow;
    const displayRows = displayRowCount();

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const firstX = clamp(Math.floor(viewLeft / cellSize), 0, columns - 1);
    const lastX = clamp(
      Math.ceil((viewLeft + cssWidth) / cellSize),
      0,
      columns - 1
    );
    const firstY = clamp(Math.floor(viewTop / cellSize), 0, displayRows - 1);
    const lastY = clamp(
      Math.ceil((viewTop + cssHeight) / cellSize),
      0,
      displayRows - 1
    );

    for (let displayY = firstY; displayY <= lastY; displayY += 1) {
      const rowNumber = rowFromDisplayY(displayY);
      const row = rowNumber === 0 ? chart.foundation : getRow(rowNumber);
      if (!row) continue;

      const localY = displayY * cellSize - viewTop;

      for (let displayX = firstX; displayX <= lastX; displayX += 1) {
        const stitchNumber = stitchFromDisplayX(displayX);
        const index = stitchNumber - 1;
        const localX = displayX * cellSize - viewLeft;

        drawCell(
          localX,
          localY,
          Number(row.colors[index]),
          row.stitches[index],
          rowNumber,
          stitchNumber
        );
      }
    }

    drawDimOverlay(viewLeft, viewTop, cssWidth, cssHeight);
    drawGrid(
      viewLeft,
      viewTop,
      cssWidth,
      cssHeight,
      firstX,
      lastX,
      firstY,
      lastY
    );
    drawSegmentOutline(viewLeft, viewTop);
  }

  function rowStats(rowNumber) {
    const row = getRow(rowNumber);
    let completedCount = 0;

    for (let stitch = 1; stitch <= chart.dimensions.stitchesPerRow; stitch += 1) {
      if (completed.has(cellKey(rowNumber, stitch))) completedCount += 1;
    }

    return { row, completedCount };
  }

  function currentSegmentStats() {
    const row = getRow(currentRow);
    const bounds = segmentBounds(currentSegment);
    const counts = { s: 0, d: 0, b: 0, c: 0 };
    let completedCount = 0;

    for (let stitch = bounds.start; stitch <= bounds.end; stitch += 1) {
      const code = row.stitches[stitch - 1];
      counts[code] = (counts[code] || 0) + 1;

      if (completed.has(cellKey(currentRow, stitch))) completedCount += 1;
    }

    return { row, bounds, counts, completedCount };
  }

  function isCurrentSegmentComplete() {
    const stats = currentSegmentStats();
    return stats.completedCount === stats.bounds.count;
  }

  function updateUi() {
    if (!chart) return;

    const total = chart.dimensions.rows * chart.dimensions.stitchesPerRow;
    const done = [...completed].filter((key) => !key.startsWith("0:")).length;
    const overallPercent = total ? (done / total) * 100 : 0;
    const row = rowStats(currentRow);
    const segment = currentSegmentStats();
    const segmentPercent = (segment.completedCount / segment.bounds.count) * 100;

    const paletteId =
      segment.row.workingColor === "A"
        ? "0"
        : segment.row.workingColor === "B"
          ? "1"
          : Object.keys(chart.palette)[0];
    const palette =
      chart.palette[paletteId] ||
      Object.values(chart.palette)[0] ||
      { name: "Color", hex: "#cccccc", rgb: [204, 204, 204] };
    const rangeText = `${segment.bounds.start}–${segment.bounds.end}`;

    ui.currentRow.textContent = currentRow;
    ui.currentSegment.textContent = currentSegment;
    ui.segmentTotal.textContent = segmentCount();
    ui.segmentRange.textContent = `Stitches ${rangeText}`;
    ui.detailSegmentRange.textContent = rangeText;
    ui.detailSegmentSize.textContent = `${segmentSize} stitch${segmentSize === 1 ? "" : "es"}`;
    ui.segmentSizeInput.max = String(chart.dimensions.stitchesPerRow);
    ui.segmentSizeInput.value = String(segmentSize);
    ui.segmentSizeStatus.textContent = `${segmentSize} stitch${segmentSize === 1 ? "" : "es"} per segment`;
    ui.jumpRow.value = currentRow;
    ui.jumpSegment.value = currentSegment;
    ui.jumpSegment.max = String(segmentCount());

    ui.workingColor.textContent = `${segment.row.workingColor} - ${palette.name}`;
    ui.workingColorSwatch.style.background = palette.hex;
    ui.singleCount.textContent = segment.counts.s.toLocaleString();
    ui.doubleCount.textContent = segment.counts.d.toLocaleString();
    ui.borderCount.textContent = segment.counts.b.toLocaleString();
    ui.segmentCompleted.textContent =
      `${segment.completedCount} of ${segment.bounds.count}`;
    ui.segmentProgressBar.style.width = `${segmentPercent}%`;
    ui.segmentProgressBar.parentElement.setAttribute(
      "aria-valuenow",
      String(segment.completedCount)
    );
    ui.segmentProgressBar.parentElement.setAttribute(
      "aria-valuemax",
      String(segment.bounds.count)
    );

    ui.rowPercent.textContent =
      `${(row.completedCount / chart.dimensions.stitchesPerRow * 100).toFixed(1)}%`;

    ui.completedCount.textContent = done.toLocaleString();
    ui.totalCount.textContent = total.toLocaleString();
    ui.overallPercent.textContent = `${overallPercent.toFixed(2)}%`;
    ui.progressBar.style.width = `${overallPercent}%`;
    ui.progressBar.parentElement.setAttribute(
      "aria-valuenow",
      overallPercent.toFixed(2)
    );

    ui.cellSizeValue.textContent = `${cellSize} px per stitch`;
    ui.focusLabel.textContent =
      `Row ${currentRow} · Segment ${currentSegment} · Stitches ${rangeText}`;
    ui.chartSummary.textContent =
      `${chart.dimensions.rows} rows × ` +
      `${chart.dimensions.stitchesPerRow} stitches · ` +
      `${segmentCount()} segments of ${segmentSize} stitch${segmentSize === 1 ? "" : "es"} per row`;
    ui.retinaInfo.textContent =
      `Sharp viewport rendering at ${dpr.toFixed(dpr % 1 ? 1 : 0)}× screen resolution.`;

    $("toggleSegment").textContent =
      isCurrentSegmentComplete() ? "Clear segment" : "Complete segment";
  }

  function progressSnapshot() {
    return {
      completed: [...completed].sort((a, b) => {
        const [rowA, stitchA] = a.split(":").map(Number);
        const [rowB, stitchB] = b.split(":").map(Number);
        return rowA - rowB || stitchA - stitchB;
      }),
      current: {
        row: currentRow,
        segment: currentSegment,
        stitch: segmentBounds(currentSegment).start
      },
      view: {
        cellSize,
        focusSegment: ui.focusSegment.checked,
        showGrid: ui.showGrid.checked,
        showSymbols: ui.showSymbols.checked,
        showFoundation,
        segmentSize
      }
    };
  }

  function saveProgress() {
    if (!chart || !activeProject) return null;

    const progress = progressSnapshot();
    activeProject.progress = progress;
    activeProject.updatedAt = new Date().toISOString();

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      ProjectStore.updateProgress(activeProject.id, progress).catch((error) => {
        console.warn("Could not save project progress.", error);
        ui.status.textContent = "Progress could not be saved";
      });
    }, 160);

    return {
      schemaVersion: 4,
      projectId: activeProject.id,
      projectName: activeProject.name,
      chartId: chart.chartId,
      title: chart.title,
      navigationMode: "variable-stitch-segments",
      segmentSize,
      ...progress,
      savedAt: new Date().toISOString()
    };
  }

  async function flushProgress() {
    clearTimeout(saveTimer);
    if (!chart || !activeProject) return;
    const progress = progressSnapshot();
    activeProject.progress = progress;
    activeProject.updatedAt = new Date().toISOString();
    await ProjectStore.updateProgress(activeProject.id, progress);
  }

  function restoreProgress() {
    if (activeProject?.progress) {
      applyProgress(activeProject.progress, false);
      return;
    }

    // Migration fallback for the earlier one-chart viewer.
    try {
      const raw = localStorage.getItem(progressStorageKey());
      if (raw) applyProgress(JSON.parse(raw), false);
    } catch (error) {
      console.warn("Could not restore legacy progress.", error);
    }
  }

  function applyProgress(payload, announce = true) {
    if (
      !payload ||
      (payload.chartId && payload.chartId !== chart.chartId) ||
      !Array.isArray(payload.completed)
    ) {
      throw new Error("This progress file belongs to a different chart.");
    }

    completed = new Set(
      payload.completed.filter((key) => /^\d+:\d+$/.test(key))
    );

    segmentSize = sanitizeSegmentSize(
      Number(payload.view?.segmentSize) ||
      Number(payload.segmentSize) ||
      DEFAULT_SEGMENT_SIZE
    );

    currentRow = clamp(
      Number(payload.current?.row) || 1,
      1,
      chart.dimensions.rows
    );

    const importedSegment =
      Number(payload.current?.segment) ||
      segmentForStitch(Number(payload.current?.stitch) || 1);

    currentSegment = clamp(importedSegment, 1, segmentCount());

    if (Number.isFinite(Number(payload.view?.cellSize))) {
      cellSize = clamp(
        Number(payload.view.cellSize),
        MIN_CELL_SIZE,
        MAX_CELL_SIZE
      );
      ui.cellSize.value = String(cellSize);
    }

    if (typeof payload.view?.focusSegment === "boolean") {
      ui.focusSegment.checked = payload.view.focusSegment;
    }
    if (typeof payload.view?.showGrid === "boolean") {
      ui.showGrid.checked = payload.view.showGrid;
    }
    if (typeof payload.view?.showSymbols === "boolean") {
      ui.showSymbols.checked = payload.view.showSymbols;
    }
    if (typeof payload.view?.showFoundation === "boolean") {
      showFoundation = payload.view.showFoundation;
      ui.showFoundation.checked = showFoundation;
    }

    updateStageSize();
    updateUi();
    queueDraw();
    saveProgress();

    if (announce) {
      ui.status.textContent = "Progress imported";
      scrollToCurrentSegment();
    }
  }

  function setCurrent(row, segment, scroll = false) {
    currentRow = clamp(row, 1, chart.dimensions.rows);
    currentSegment = clamp(segment, 1, segmentCount());

    updateUi();
    queueDraw();
    saveProgress();

    if (scroll) scrollToCurrentSegment();
  }

  function moveSegment(delta) {
    let linear =
      (currentRow - 1) * segmentCount() +
      (currentSegment - 1) +
      delta;

    linear = clamp(
      linear,
      0,
      chart.dimensions.rows * segmentCount() - 1
    );

    setCurrent(
      Math.floor(linear / segmentCount()) + 1,
      (linear % segmentCount()) + 1,
      true
    );
  }

  function moveRow(delta) {
    setCurrent(currentRow + delta, currentSegment, true);
  }

  function setCurrentSegmentComplete(done) {
    const bounds = segmentBounds(currentSegment);

    for (let stitch = bounds.start; stitch <= bounds.end; stitch += 1) {
      const key = cellKey(currentRow, stitch);
      if (done) completed.add(key);
      else completed.delete(key);
    }

    updateUi();
    queueDraw();
    saveProgress();
  }

  function toggleCurrentSegment() {
    setCurrentSegmentComplete(!isCurrentSegmentComplete());
  }

  function completeAndNext() {
    setCurrentSegmentComplete(true);
    moveSegment(1);
  }

  function setRowComplete(done) {
    for (
      let stitch = 1;
      stitch <= chart.dimensions.stitchesPerRow;
      stitch += 1
    ) {
      const key = cellKey(currentRow, stitch);
      if (done) completed.add(key);
      else completed.delete(key);
    }

    updateUi();
    queueDraw();
    saveProgress();
  }

  function scrollToCurrentSegment(behavior = "smooth") {
    const rect = currentSegmentRectangle();
    const targetLeft =
      rect.x - viewport.clientWidth / 2 + rect.width / 2;
    const targetTop =
      rect.y - viewport.clientHeight / 2 + rect.height / 2;

    viewport.scrollTo({
      left: Math.max(0, targetLeft),
      top: Math.max(0, targetTop),
      behavior
    });
  }

  function changeZoom(nextSize, centerCurrent = true) {
    cellSize = clamp(
      Math.round(nextSize),
      MIN_CELL_SIZE,
      MAX_CELL_SIZE
    );
    ui.cellSize.value = String(cellSize);

    updateStageSize();
    updateUi();
    queueDraw();

    requestAnimationFrame(() => {
      if (centerCurrent) scrollToCurrentSegment("auto");
      saveProgress();
    });
  }

  function fitCurrentSegment() {
    const availableWidth = Math.max(200, viewport.clientWidth - 80);
    const availableHeight = Math.max(90, viewport.clientHeight - 110);
    const byWidth = availableWidth / (segmentSize + 1);
    const byHeight = availableHeight / 3.25;

    changeZoom(Math.min(byWidth, byHeight, MAX_CELL_SIZE));
  }

  function fitWholeChart() {
    const availableWidth = Math.max(200, viewport.clientWidth - 8);
    const availableHeight = Math.max(200, viewport.clientHeight - 8);
    const byWidth = availableWidth / chart.dimensions.stitchesPerRow;
    const byHeight = availableHeight / displayRowCount();

    changeZoom(Math.min(byWidth, byHeight), false);
    viewport.scrollTo({ left: 0, top: 0, behavior: "auto" });
  }

  function eventCell(event) {
    const canvasRect = canvas.getBoundingClientRect();
    const localX = event.clientX - canvasRect.left;
    const localY = event.clientY - canvasRect.top;
    const globalX = viewport.scrollLeft + localX;
    const globalY = viewport.scrollTop + localY;

    const displayX = Math.floor(globalX / cellSize);
    const displayY = Math.floor(globalY / cellSize);

    if (
      displayX < 0 ||
      displayX >= chart.dimensions.stitchesPerRow ||
      displayY < 0 ||
      displayY >= displayRowCount()
    ) {
      return null;
    }

    return {
      row: rowFromDisplayY(displayY),
      stitch: stitchFromDisplayX(displayX)
    };
  }

  function updateHover(cell) {
    if (!cell) {
      ui.hoverInfo.textContent =
        "Click any cell to select its current-size segment";
      return;
    }

    if (cell.row === 0) {
      ui.hoverInfo.textContent =
        `Foundation chain · Stitch ${cell.stitch}`;
      return;
    }

    const segment = segmentForStitch(cell.stitch);
    const bounds = segmentBounds(segment);

    ui.hoverInfo.textContent =
      `Row ${cell.row} · Segment ${segment} · Stitches ${bounds.start}–${bounds.end}`;
  }

  function buildLegend() {
    ui.colorLegend.innerHTML = "";

    for (const palette of Object.values(chart.palette)) {
      const item = document.createElement("div");
      item.className = "legend-color";
      item.innerHTML =
        `<span class="legend-chip" style="background:${palette.hex}"></span>` +
        `<span>${palette.name} (${palette.hex})</span>`;
      ui.colorLegend.appendChild(item);
    }
  }

  function exportProgress() {
    const payload = saveProgress();
    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    const safeName = activeProject.name
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "crochet-project";

    anchor.href = url;
    anchor.download = `${safeName}-progress.json`;
    anchor.click();

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }


  function formatBackupTime(value) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function renderBackupStatus(status) {
    currentBackupStatus = status;
    ui.backupStatusChip.className = "backup-chip";

    if (!status.supported) {
      ui.backupStatusChip.classList.add("warning");
      ui.backupStatusChip.textContent = "Auto-backup unavailable";
      $("backupNow").textContent = "Download from Projects";
      return;
    }

    if (!status.enabled || !status.hasHandle) {
      ui.backupStatusChip.textContent = "Auto-backup not connected";
      $("backupNow").textContent = "Set Up Auto-Backup";
      return;
    }

    $("backupNow").textContent = "Back Up Now";

    if (status.saving) {
      ui.backupStatusChip.textContent = "Backing up...";
      return;
    }

    if (status.pending) {
      ui.backupStatusChip.textContent = "Backup pending";
      return;
    }

    if (status.permission !== "granted" || status.error) {
      ui.backupStatusChip.classList.add("warning");
      ui.backupStatusChip.textContent = "Backup needs permission";
      return;
    }

    ui.backupStatusChip.classList.add("success");
    ui.backupStatusChip.textContent = status.lastSavedAt
      ? `Backed up ${formatBackupTime(status.lastSavedAt)}`
      : "Auto-backup connected";
  }

  async function backupLibraryNow() {
    const status = currentBackupStatus;

    if (!status?.supported) {
      alert(
        "Automatic file backup is not available in this browser. Return to Projects and use Download Backup."
      );
      return;
    }

    // A file picker or permission prompt must be invoked directly from this
    // button click. Do not await another operation before opening it.
    if (!status.enabled || !status.hasHandle) {
      await ProjectStore.enableAutoBackup();
      await flushProgress();
      await ProjectStore.flushAutoBackup();
      return;
    }

    if (status.permission !== "granted") {
      await ProjectStore.reconnectAutoBackup();
      await flushProgress();
      await ProjectStore.flushAutoBackup();
      return;
    }

    await flushProgress();
    await ProjectStore.backupNow();
  }

  function refreshDevicePixelRatio() {
    const nextDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (Math.abs(nextDpr - dpr) > 0.01) {
      dpr = nextDpr;
      lastCanvasCssWidth = 0;
      lastCanvasCssHeight = 0;
      updateUi();
      queueDraw();
    }
  }

  function bindEvents() {
    $("changeProject").addEventListener("click", async () => {
      await flushProgress();
      await ProjectStore.flushAutoBackup();
      window.location.href = "index.html";
    });

    $("newProject").addEventListener("click", async () => {
      await flushProgress();
      await ProjectStore.flushAutoBackup();
      window.location.href = "index.html?new=1";
    });

    $("backupNow").addEventListener("click", () => {
      backupLibraryNow().catch((error) => {
        if (error?.name === "AbortError") return;

        console.error(error);
        alert(`Could not update the backup: ${error.message}`);
      });
    });

    $("previousSegment").addEventListener("click", () => moveSegment(-1));
    $("nextSegment").addEventListener("click", () => moveSegment(1));
    $("toggleSegment").addEventListener("click", toggleCurrentSegment);
    $("completeNext").addEventListener("click", completeAndNext);

    $("applySegmentSize").addEventListener("click", () => {
      applySegmentSizeChange(ui.segmentSizeInput.value, true);
    });

    ui.segmentSizeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applySegmentSizeChange(ui.segmentSizeInput.value, true);
      }
    });

    ui.segmentSizeInput.addEventListener("change", () => {
      applySegmentSizeChange(ui.segmentSizeInput.value, true);
    });

    $("jumpButton").addEventListener("click", () => {
      setCurrent(
        Number(ui.jumpRow.value),
        Number(ui.jumpSegment.value),
        true
      );
    });

    $("completeRow").addEventListener("click", () => setRowComplete(true));
    $("clearRow").addEventListener("click", () => setRowComplete(false));
    $("scrollCurrent").addEventListener("click", () => scrollToCurrentSegment());
    $("fitSegment").addEventListener("click", fitCurrentSegment);
    $("fitWidth").addEventListener("click", fitWholeChart);
    $("exportProgress").addEventListener("click", exportProgress);

    $("zoomOut").addEventListener("click", () => {
      changeZoom(cellSize - 6);
    });

    $("zoomIn").addEventListener("click", () => {
      changeZoom(cellSize + 6);
    });

    $("resetProgress").addEventListener("click", () => {
      if (!confirm(`Clear all progress for "${activeProject.name}"?`)) return;

      completed.clear();
      currentRow = 1;
      currentSegment = 1;

      updateUi();
      queueDraw();
      saveProgress();
      scrollToCurrentSegment();
    });

    $("importProgress").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        applyProgress(JSON.parse(await file.text()));
      } catch (error) {
        alert(error.message);
      }

      event.target.value = "";
    });

    ui.cellSize.addEventListener("input", () => {
      changeZoom(Number(ui.cellSize.value));
    });

    ui.focusSegment.addEventListener("change", () => {
      queueDraw();
      saveProgress();
    });

    ui.showGrid.addEventListener("change", () => {
      queueDraw();
      saveProgress();
    });
    ui.showSymbols.addEventListener("change", () => {
      queueDraw();
      saveProgress();
    });

    ui.showFoundation.addEventListener("change", () => {
      showFoundation = ui.showFoundation.checked;
      updateStageSize();
      queueDraw();
      saveProgress();
    });

    viewport.addEventListener("scroll", queueDraw, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      refreshDevicePixelRatio();
      queueDraw();
    });
    resizeObserver.observe(viewport);

    window.addEventListener("resize", () => {
      refreshDevicePixelRatio();
      queueDraw();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushProgress().catch(() => {});
      }
    });

    window.addEventListener("beforeunload", () => {
      saveProgress();
    });

    canvas.addEventListener("mousemove", (event) => {
      updateHover(eventCell(event));
    });

    canvas.addEventListener("mouseleave", () => updateHover(null));

    canvas.addEventListener("click", (event) => {
      const cell = eventCell(event);
      if (!cell || cell.row === 0) return;

      setCurrent(
        cell.row,
        segmentForStitch(cell.stitch),
        true
      );
    });

    document.addEventListener("keydown", (event) => {
      const tag = document.activeElement?.tagName;

      if (["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(tag)) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSegment(-1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSegment(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveRow(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveRow(-1);
      } else if (event.key === " ") {
        event.preventDefault();
        toggleCurrentSegment();
      } else if (event.key === "Enter") {
        event.preventDefault();
        completeAndNext();
      }
    });
  }

  async function init() {
    try {
      chart = validateChart(await loadProjectChart());
      rowsByNumber = new Map(chart.rows.map((row) => [row.number, row]));

      ui.projectName.textContent = activeProject.name;
      document.title = `${activeProject.name} - Mosaic Crochet Viewer`;
      ui.jumpRow.max = String(chart.dimensions.rows);
      ui.jumpSegment.max = String(segmentCount());
      ui.segmentTotal.textContent = String(segmentCount());

      ui.status.textContent = "Project ready";
      ProjectStore.onAutoBackupStatus(renderBackupStatus);
      await ProjectStore.getAutoBackupStatus();
      buildLegend();
      restoreProgress();
      bindEvents();
      updateStageSize();
      updateUi();
      queueDraw();

      setTimeout(() => {
        scrollToCurrentSegment("auto");
      }, 120);
    } catch (error) {
      console.error(error);
      ui.status.textContent = "Project failed to load";
      if (!window.location.href.endsWith("index.html")) {
        alert(`Could not load the project: ${error.message}`);
      }
    }
  }

  init();
})();
