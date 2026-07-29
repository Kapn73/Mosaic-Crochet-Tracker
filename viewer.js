(() => {
  "use strict";

  const DEFAULT_SEGMENT_SIZE = 10;
  const MIN_CELL_SIZE = 4;
  const MAX_CELL_SIZE = 120;
  const MAX_DPR = 2.5;
  const MAX_UNDO_ACTIONS = 20;
  const SAVE_DELAY = 180;

  const $ = (id) => document.getElementById(id);
  const canvas = $("chartCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const viewport = $("chartViewport");
  const stage = $("chartStage");
  const segmentStripCanvas = $("segmentStripCanvas");
  const segmentStripCtx = segmentStripCanvas.getContext("2d", { alpha: false });
  const stitchRulerCanvas = $("stitchRulerCanvas");
  const stitchRulerCtx = stitchRulerCanvas.getContext("2d", { alpha: true });

  let activeProject = null;
  let chart = null;
  let rowsByNumber = new Map();
  let completed = new Set();

  let currentRow = 1;
  let currentSegment = 1;
  let currentStitch = 1;
  let segmentSize = DEFAULT_SEGMENT_SIZE;
  let cellSize = 44;
  let showFoundation = false;
  let scrollMode = "center";
  let keepScreenAwake = false;
  let wakeLockSentinel = null;
  let controlsLocked = false;
  let crochetMode = false;

  let drawQueued = false;
  let saveTimer = null;
  let lastCanvasCssWidth = 0;
  let lastCanvasCssHeight = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  let currentBackupStatus = null;
  let undoStack = [];
  let suppressUndo = false;
  let notesSaveTimer = null;
  let rowNoteEditorRow = 0;

  const ui = {
    projectName: $("projectName"),
    chartSummary: $("chartSummary"),
    status: $("status"),
    hoverInfo: $("hoverInfo"),
    focusLabel: $("focusLabel"),

    currentRow: $("currentRow"),
    currentSegment: $("currentSegment"),
    currentStitch: $("currentStitch"),
    segmentTotal: $("segmentTotal"),
    segmentRange: $("segmentRange"),
    stitchPositionLabel: $("stitchPositionLabel"),

    detailSegmentRange: $("detailSegmentRange"),
    detailSegmentSize: $("detailSegmentSize"),
    segmentSizeInput: $("segmentSizeInput"),
    segmentSizeStatus: $("segmentSizeStatus"),
    jumpRow: $("jumpRow"),
    jumpSegment: $("jumpSegment"),

    workingColor: $("workingColor"),
    workingColorSwatch: $("workingColorSwatch"),
    currentRowColor: $("currentRowColor"),
    currentRowColorSwatch: $("currentRowColorSwatch"),
    nextRowColor: $("nextRowColor"),
    nextRowColorSwatch: $("nextRowColorSwatch"),
    colorChangeNotice: $("colorChangeNotice"),

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
    scrollMode: $("scrollMode"),
    keepScreenAwake: $("keepScreenAwake"),
    wakeLockStatus: $("wakeLockStatus"),

    activeSegmentStripSummary: $("activeSegmentStripSummary"),
    activeSegmentDirection: $("activeSegmentDirection"),

    yarnBrand: $("yarnBrand"),
    hookSize: $("hookSize"),
    gauge: $("gauge"),
    projectStartDate: $("projectStartDate"),
    projectNotes: $("projectNotes"),
    rowNoteNumber: $("rowNoteNumber"),
    rowNote: $("rowNote"),
    rowNoteStatus: $("rowNoteStatus"),

    colorLegend: $("colorLegend"),
    yarnColorEditor: $("yarnColorEditor"),
    backupStatusChip: $("backupStatusChip"),

    undoAction: $("undoAction"),
    mobileUndo: $("mobileUndo"),
    mobilePosition: $("mobilePosition"),
    mobileRange: $("mobileRange"),
    topInteractionLock: $("toggleInteractionLock"),
    sidebarInteractionLock: $("sidebarInteractionLock"),
    mobileInteractionLock: $("mobileInteractionLock")
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

    return ProjectStore.validateChart(activeProject.chart);
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
    const end = Math.min(
      start + segmentSize - 1,
      chart.dimensions.stitchesPerRow
    );

    return { start, end, count: end - start + 1 };
  }

  function segmentForStitch(stitchNumber) {
    return Math.floor((stitchNumber - 1) / segmentSize) + 1;
  }

  function normalizeCurrentStitch(stitchNumber = currentStitch) {
    const bounds = segmentBounds(currentSegment);
    return clamp(
      Math.round(Number(stitchNumber) || bounds.start),
      bounds.start,
      bounds.end
    );
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

  function paletteForWorkingColor(workingColor) {
    const paletteId =
      workingColor === "A"
        ? "0"
        : workingColor === "B"
          ? "1"
          : Object.keys(chart.palette)[0];

    return (
      chart.palette[paletteId] ||
      Object.values(chart.palette)[0] ||
      {
        name: "Color",
        hex: "#CCCCCC",
        rgb: [204, 204, 204]
      }
    );
  }

  function applySegmentSizeChange(nextSize, announce = false) {
    const anchorStitch = chart ? currentStitch : 1;

    segmentSize = sanitizeSegmentSize(nextSize);
    currentSegment = clamp(
      segmentForStitch(anchorStitch),
      1,
      segmentCount()
    );
    currentStitch = normalizeCurrentStitch(anchorStitch);

    ui.segmentSizeInput.max = String(chart.dimensions.stitchesPerRow);
    ui.segmentSizeInput.value = String(segmentSize);
    ui.jumpSegment.max = String(segmentCount());

    updateStageSize();
    updateUi();
    queueDraw();
    saveProgress();

    if (announce) {
      ui.status.textContent = `Segment size set to ${segmentSize}`;
    }

    requestAnimationFrame(() => {
      applyAutomaticChartMovement("auto");
    });
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

  function currentStitchRectangle() {
    return {
      x: displayXForStitch(currentStitch) * cellSize,
      y: displayYForRow(currentRow) * cellSize,
      width: cellSize,
      height: cellSize
    };
  }

  function updateStageSize() {
    stage.style.width =
      `${chart.dimensions.stitchesPerRow * cellSize}px`;
    stage.style.height =
      `${displayRowCount() * cellSize}px`;
  }

  function queueDraw() {
    if (drawQueued) return;

    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      drawVisibleChart();
      drawActiveSegmentStrip();
      drawStitchRuler();
    });
  }

  function prepareAuxiliaryCanvas(target, context, cssWidth, cssHeight) {
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (target.width !== pixelWidth || target.height !== pixelHeight) {
      target.width = pixelWidth;
      target.height = pixelHeight;
    }

    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, width, height);

    return { width, height };
  }

  function drawActiveSegmentStrip() {
    if (!chart || !segmentStripCanvas?.parentElement) return;

    const row = getRow(currentRow);
    const bounds = segmentBounds(currentSegment);
    const wrap = segmentStripCanvas.parentElement;
    const visibleWidth = Math.max(280, wrap.clientWidth || 640);
    const stripCellSize = clamp(
      Math.floor(visibleWidth / Math.min(bounds.count, 12)),
      44,
      64
    );
    const labelHeight = 28;
    const topPadding = 8;
    const cssWidth = Math.max(visibleWidth, bounds.count * stripCellSize);
    const cssHeight = stripCellSize + labelHeight + topPadding * 2;
    const size = prepareAuxiliaryCanvas(
      segmentStripCanvas,
      segmentStripCtx,
      cssWidth,
      cssHeight
    );

    segmentStripCtx.fillStyle = "#111827";
    segmentStripCtx.fillRect(0, 0, size.width, size.height);

    for (let visualIndex = 0; visualIndex < bounds.count; visualIndex += 1) {
      const stitch = bounds.end - visualIndex;
      const chartIndex = stitch - 1;
      const palette =
        chart.palette[String(row.colors[chartIndex])] ||
        Object.values(chart.palette)[0];
      const x = visualIndex * stripCellSize;
      const y = topPadding;
      const code = row.stitches[chartIndex];
      const key = cellKey(currentRow, stitch);

      segmentStripCtx.fillStyle = palette.hex;
      segmentStripCtx.fillRect(x, y, stripCellSize, stripCellSize);

      if (completed.has(key)) {
        segmentStripCtx.fillStyle = "rgba(34, 197, 94, 0.52)";
        segmentStripCtx.fillRect(x, y, stripCellSize, stripCellSize);
      }

      segmentStripCtx.strokeStyle = "rgba(255,255,255,0.34)";
      segmentStripCtx.lineWidth = 1;
      segmentStripCtx.strokeRect(
        x + 0.5,
        y + 0.5,
        stripCellSize - 1,
        stripCellSize - 1
      );

      const symbolColor = symbolColorFor(palette);
      if (code === "d") {
        const inset = stripCellSize * 0.24;
        segmentStripCtx.strokeStyle = symbolColor;
        segmentStripCtx.lineWidth = Math.max(2, stripCellSize * 0.065);
        segmentStripCtx.lineCap = "round";
        segmentStripCtx.beginPath();
        segmentStripCtx.moveTo(x + inset, y + inset);
        segmentStripCtx.lineTo(
          x + stripCellSize - inset,
          y + stripCellSize - inset
        );
        segmentStripCtx.moveTo(x + stripCellSize - inset, y + inset);
        segmentStripCtx.lineTo(x + inset, y + stripCellSize - inset);
        segmentStripCtx.stroke();
      } else if (code === "b") {
        segmentStripCtx.fillStyle = symbolColor;
        segmentStripCtx.font = `700 ${Math.max(11, stripCellSize * 0.25)}px ui-sans-serif, sans-serif`;
        segmentStripCtx.textAlign = "center";
        segmentStripCtx.textBaseline = "middle";
        segmentStripCtx.fillText(
          "BS",
          x + stripCellSize / 2,
          y + stripCellSize / 2
        );
      }

      if (stitch === currentStitch) {
        segmentStripCtx.strokeStyle = "#FFFFFF";
        segmentStripCtx.lineWidth = 5;
        segmentStripCtx.strokeRect(
          x + 3,
          y + 3,
          stripCellSize - 6,
          stripCellSize - 6
        );
        segmentStripCtx.strokeStyle = "#7C3AED";
        segmentStripCtx.lineWidth = 2.5;
        segmentStripCtx.strokeRect(
          x + 8,
          y + 8,
          stripCellSize - 16,
          stripCellSize - 16
        );
      }

      segmentStripCtx.fillStyle = "#F8FAFC";
      segmentStripCtx.font = "600 12px ui-sans-serif, sans-serif";
      segmentStripCtx.textAlign = "center";
      segmentStripCtx.textBaseline = "middle";
      segmentStripCtx.fillText(
        String(stitch),
        x + stripCellSize / 2,
        y + stripCellSize + labelHeight / 2
      );
    }

    ui.activeSegmentStripSummary.textContent =
      `Row ${currentRow} · Stitches ${bounds.start}–${bounds.end}`;
    ui.activeSegmentDirection.textContent = "Work direction ←";

    const currentVisualIndex = bounds.end - currentStitch;
    const currentCenter = currentVisualIndex * stripCellSize + stripCellSize / 2;
    const leftEdge = wrap.scrollLeft;
    const rightEdge = leftEdge + wrap.clientWidth;
    if (currentCenter < leftEdge + stripCellSize || currentCenter > rightEdge - stripCellSize) {
      wrap.scrollTo({
        left: Math.max(0, currentCenter - wrap.clientWidth / 2),
        behavior: "smooth"
      });
    }
  }

  function rulerStepForZoom() {
    if (cellSize >= 40) return 1;
    if (cellSize >= 20) return 5;
    if (cellSize >= 10) return 10;
    return 25;
  }

  function drawStitchRuler() {
    if (!chart || !viewport.clientWidth) return;

    const cssWidth = viewport.clientWidth;
    const cssHeight = 38;
    prepareAuxiliaryCanvas(
      stitchRulerCanvas,
      stitchRulerCtx,
      cssWidth,
      cssHeight
    );

    const viewLeft = viewport.scrollLeft;
    const firstDisplayX = clamp(
      Math.floor(viewLeft / cellSize),
      0,
      chart.dimensions.stitchesPerRow - 1
    );
    const lastDisplayX = clamp(
      Math.ceil((viewLeft + cssWidth) / cellSize),
      0,
      chart.dimensions.stitchesPerRow - 1
    );
    const step = rulerStepForZoom();
    const bounds = segmentBounds(currentSegment);
    const segmentX = displayXForStitch(bounds.end) * cellSize - viewLeft;
    const segmentWidth = bounds.count * cellSize;

    stitchRulerCtx.fillStyle = "rgba(124, 58, 237, 0.13)";
    stitchRulerCtx.fillRect(segmentX, 0, segmentWidth, cssHeight);
    stitchRulerCtx.strokeStyle = "rgba(148, 163, 184, 0.75)";
    stitchRulerCtx.lineWidth = 1;
    stitchRulerCtx.beginPath();
    stitchRulerCtx.moveTo(0, cssHeight - 1);
    stitchRulerCtx.lineTo(cssWidth, cssHeight - 1);
    stitchRulerCtx.stroke();

    for (let displayX = firstDisplayX; displayX <= lastDisplayX; displayX += 1) {
      const stitch = stitchFromDisplayX(displayX);
      const showNumber = stitch === 1 || stitch % step === 0;
      if (!showNumber) continue;

      const x = displayX * cellSize - viewLeft + cellSize / 2;
      stitchRulerCtx.strokeStyle =
        stitch === currentStitch ? "#7C3AED" : "rgba(100, 116, 139, 0.9)";
      stitchRulerCtx.lineWidth = stitch === currentStitch ? 2.5 : 1;
      stitchRulerCtx.beginPath();
      stitchRulerCtx.moveTo(x, cssHeight - 11);
      stitchRulerCtx.lineTo(x, cssHeight - 1);
      stitchRulerCtx.stroke();

      stitchRulerCtx.fillStyle =
        stitch === currentStitch ? "#7C3AED" : "#64748B";
      stitchRulerCtx.font =
        `${stitch === currentStitch ? "700" : "600"} 11px ui-sans-serif, sans-serif`;
      stitchRulerCtx.textAlign = "center";
      stitchRulerCtx.textBaseline = "middle";
      stitchRulerCtx.fillText(String(stitch), x, 12);
    }
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
    const rgb = palette.rgb || [128, 128, 128];
    const brightness =
      (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;

    return brightness > 145
      ? "rgba(0,0,0,0.76)"
      : "rgba(255,255,255,0.88)";
  }

  function drawCell(
    localX,
    localY,
    colorId,
    stitchCode,
    rowNumber,
    stitchNumber
  ) {
    const size = cellSize;
    const palette =
      chart.palette[String(colorId)] ||
      Object.values(chart.palette)[0];

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

    // Blank cells are single crochet. Only d cells display an X.
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
      ctx.font =
        `600 ${Math.max(7, size * 0.30)}px ui-sans-serif, sans-serif`;
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
    if (bottom < height) {
      ctx.fillRect(0, bottom, width, height - bottom);
    }
    if (left > 0 && bottom > top) {
      ctx.fillRect(0, top, left, bottom - top);
    }
    if (right < width && bottom > top) {
      ctx.fillRect(right, top, width - right, bottom - top);
    }
  }

  function drawGrid(
    viewLeft,
    viewTop,
    width,
    height,
    firstX,
    lastX,
    firstY,
    lastY
  ) {
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

    ctx.strokeStyle = "#FFB703";
    ctx.lineWidth = Math.max(2.5, Math.min(5, cellSize * 0.10));
    ctx.strokeRect(
      x + ctx.lineWidth / 2,
      y + ctx.lineWidth / 2,
      Math.max(1, rect.width - ctx.lineWidth),
      Math.max(1, rect.height - ctx.lineWidth)
    );
  }

  function drawStitchOutline(viewLeft, viewTop) {
    const rect = currentStitchRectangle();
    const x = rect.x - viewLeft;
    const y = rect.y - viewTop;

    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = Math.max(2, Math.min(4, cellSize * 0.12));
    ctx.strokeRect(
      x + ctx.lineWidth,
      y + ctx.lineWidth,
      Math.max(1, rect.width - ctx.lineWidth * 2),
      Math.max(1, rect.height - ctx.lineWidth * 2)
    );

    ctx.strokeStyle = "#7C3AED";
    ctx.lineWidth = Math.max(1.5, Math.min(3, cellSize * 0.075));
    ctx.strokeRect(
      x + ctx.lineWidth * 2,
      y + ctx.lineWidth * 2,
      Math.max(1, rect.width - ctx.lineWidth * 4),
      Math.max(1, rect.height - ctx.lineWidth * 4)
    );
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
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const firstX = clamp(
      Math.floor(viewLeft / cellSize),
      0,
      columns - 1
    );
    const lastX = clamp(
      Math.ceil((viewLeft + cssWidth) / cellSize),
      0,
      columns - 1
    );
    const firstY = clamp(
      Math.floor(viewTop / cellSize),
      0,
      displayRows - 1
    );
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
        const localX = displayX * cellSize - viewLeft;
        const index = stitchNumber - 1;

        drawCell(
          localX,
          localY,
          row.colors[index],
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
    drawStitchOutline(viewLeft, viewTop);
  }

  function rowStats(rowNumber) {
    const row = getRow(rowNumber);
    let completedCount = 0;

    for (
      let stitch = 1;
      stitch <= chart.dimensions.stitchesPerRow;
      stitch += 1
    ) {
      if (completed.has(cellKey(rowNumber, stitch))) {
        completedCount += 1;
      }
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

      if (completed.has(cellKey(currentRow, stitch))) {
        completedCount += 1;
      }
    }

    return { row, bounds, counts, completedCount };
  }

  function isCurrentSegmentComplete() {
    const stats = currentSegmentStats();
    return stats.completedCount === stats.bounds.count;
  }

  function isCurrentStitchComplete() {
    return completed.has(cellKey(currentRow, currentStitch));
  }

  function completedChartCount() {
    let count = 0;
    for (const key of completed) {
      if (!String(key).startsWith("0:")) count += 1;
    }
    return count;
  }

  function updateUndoButtons() {
    const disabled = undoStack.length === 0 || controlsLocked;
    ui.undoAction.disabled = disabled;
    ui.mobileUndo.disabled = disabled;
    const label = disabled
      ? "Undo"
      : `Undo ${undoStack[undoStack.length - 1].label}`;
    ui.undoAction.textContent = label;
    ui.mobileUndo.textContent = "Undo";
    ui.undoAction.title = label;
    ui.mobileUndo.title = label;
  }

  function updateUi() {
    if (!chart) return;

    currentSegment = clamp(currentSegment, 1, segmentCount());
    currentStitch = normalizeCurrentStitch(currentStitch);

    const total =
      chart.dimensions.rows * chart.dimensions.stitchesPerRow;
    const done = completedChartCount();
    const overallPercent = total ? done / total * 100 : 0;
    const row = rowStats(currentRow);
    const segment = currentSegmentStats();
    const segmentPercent =
      segment.bounds.count
        ? segment.completedCount / segment.bounds.count * 100
        : 0;

    const palette = paletteForWorkingColor(segment.row.workingColor);
    const nextRow = currentRow < chart.dimensions.rows
      ? getRow(currentRow + 1)
      : null;
    const nextPalette = nextRow
      ? paletteForWorkingColor(nextRow.workingColor)
      : null;
    const rangeText = `${segment.bounds.start}–${segment.bounds.end}`;
    const positionInSegment =
      currentStitch - segment.bounds.start + 1;

    ui.currentRow.textContent = String(currentRow);
    ui.currentSegment.textContent = String(currentSegment);
    ui.currentStitch.textContent = String(currentStitch);
    ui.segmentTotal.textContent = String(segmentCount());
    ui.segmentRange.textContent = `Stitches ${rangeText}`;
    ui.stitchPositionLabel.textContent =
      `${positionInSegment} of ${segment.bounds.count} in this segment`;

    ui.detailSegmentRange.textContent = rangeText;
    ui.detailSegmentSize.textContent =
      `${segmentSize} stitch${segmentSize === 1 ? "" : "es"}`;
    ui.segmentSizeInput.max =
      String(chart.dimensions.stitchesPerRow);
    ui.segmentSizeInput.value = String(segmentSize);
    ui.segmentSizeStatus.textContent =
      `${segmentSize} stitch${segmentSize === 1 ? "" : "es"} per segment`;
    ui.jumpRow.value = String(currentRow);
    ui.jumpSegment.value = String(currentSegment);
    ui.jumpSegment.max = String(segmentCount());

    ui.workingColor.textContent =
      `${segment.row.workingColor} - ${palette.name}`;
    ui.workingColorSwatch.style.background = palette.hex;

    ui.currentRowColor.textContent =
      `${segment.row.workingColor} - ${palette.name}`;
    ui.currentRowColorSwatch.style.background = palette.hex;

    if (nextRow && nextPalette) {
      ui.nextRowColor.textContent =
        `${nextRow.workingColor} - ${nextPalette.name}`;
      ui.nextRowColorSwatch.style.background = nextPalette.hex;
      ui.colorChangeNotice.textContent =
        nextRow.workingColor === segment.row.workingColor
          ? "The next row continues with the same working color."
          : `Color change after this row: switch to ${nextPalette.name}.`;
      ui.colorChangeNotice.classList.toggle(
        "color-change-alert",
        nextRow.workingColor !== segment.row.workingColor
      );
    } else {
      ui.nextRowColor.textContent = "Finished";
      ui.nextRowColorSwatch.style.background = "transparent";
      ui.colorChangeNotice.textContent = "This is the final chart row.";
      ui.colorChangeNotice.classList.remove("color-change-alert");
    }

    ui.singleCount.textContent =
      segment.counts.s.toLocaleString();
    ui.doubleCount.textContent =
      segment.counts.d.toLocaleString();
    ui.borderCount.textContent =
      segment.counts.b.toLocaleString();
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
      `${(
        row.completedCount /
        chart.dimensions.stitchesPerRow *
        100
      ).toFixed(1)}%`;

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
      `Row ${currentRow} · Segment ${currentSegment} · Stitch ${currentStitch} · Range ${rangeText}`;
    ui.chartSummary.textContent =
      `${chart.dimensions.rows} rows × ` +
      `${chart.dimensions.stitchesPerRow} stitches · ` +
      `${segmentCount()} segments of ${segmentSize} stitch${
        segmentSize === 1 ? "" : "es"
      } per row`;
    ui.retinaInfo.textContent =
      `Sharp viewport rendering at ${dpr.toFixed(
        dpr % 1 ? 1 : 0
      )}× screen resolution.`;

    $("toggleSegment").textContent =
      isCurrentSegmentComplete()
        ? "Clear segment"
        : "Complete segment";
    $("toggleStitch").textContent =
      isCurrentStitchComplete()
        ? "Clear stitch"
        : "Complete stitch";

    ui.mobilePosition.textContent =
      `Row ${currentRow} · Stitch ${currentStitch}`;
    ui.mobileRange.textContent =
      `Segment ${currentSegment} · ${rangeText}`;

    document.body.classList.toggle("crochet-mode", crochetMode);
    $("toggleCrochetMode").textContent =
      crochetMode ? "Full Controls" : "Crochet Mode";
    syncRowNoteEditor();
    updateInteractionLockUi();
    updateWakeLockStatus();
    updateUndoButtons();
  }

  function progressSnapshot() {
    return {
      completed: [...completed],
      current: {
        row: currentRow,
        segment: currentSegment,
        stitch: currentStitch
      },
      view: {
        cellSize,
        focusSegment: ui.focusSegment.checked,
        showGrid: ui.showGrid.checked,
        showSymbols: ui.showSymbols.checked,
        showFoundation,
        scrollMode,
        autoCenter: scrollMode !== "off",
        keepScreenAwake,
        crochetMode,
        segmentSize
      }
    };
  }

  function saveProgress() {
    if (!chart || !activeProject) return null;

    const progress = progressSnapshot();
    activeProject.progress = progress;
    activeProject.updatedAt = new Date().toISOString();

    ProjectStore.saveRecoveryProgress(
      activeProject.id,
      progress,
      chart
    );

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      ProjectStore.updateProgress(activeProject.id, progress, chart)
        .then(() => {
          ui.status.textContent = "Progress saved";
        })
        .catch((error) => {
          console.warn("Could not save project progress.", error);
          ui.status.textContent = "Progress could not be saved";
        });
    }, SAVE_DELAY);

    return {
      schemaVersion: 6,
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
    ProjectStore.saveRecoveryProgress(activeProject.id, progress, chart);
    await ProjectStore.updateProgress(activeProject.id, progress, chart);
  }

  function restoreProgress() {
    if (activeProject?.progress) {
      applyProgress(activeProject.progress, false);
    }
  }

  function applyProgress(payload, announce = true) {
    if (
      !payload ||
      (payload.chartId && payload.chartId !== chart.chartId) ||
      !Array.isArray(payload.completed)
    ) {
      throw new Error(
        "This progress file belongs to a different chart."
      );
    }

    const normalized = ProjectStore.normalizeProgress(payload, chart);
    undoStack = [];
    completed = new Set(normalized.completed);
    segmentSize = sanitizeSegmentSize(
      normalized.view.segmentSize || DEFAULT_SEGMENT_SIZE
    );
    currentRow = normalized.current.row;
    currentSegment = normalized.current.segment;
    currentStitch = normalized.current.stitch;

    cellSize = clamp(
      Number(normalized.view.cellSize) || 44,
      MIN_CELL_SIZE,
      MAX_CELL_SIZE
    );
    ui.cellSize.value = String(cellSize);
    ui.focusSegment.checked = normalized.view.focusSegment;
    ui.showGrid.checked = normalized.view.showGrid;
    ui.showSymbols.checked = normalized.view.showSymbols;
    showFoundation = normalized.view.showFoundation;
    ui.showFoundation.checked = showFoundation;
    scrollMode = normalized.view.scrollMode ||
      (normalized.view.autoCenter === false ? "off" : "center");
    ui.scrollMode.value = scrollMode;
    keepScreenAwake = Boolean(normalized.view.keepScreenAwake);
    ui.keepScreenAwake.checked = keepScreenAwake;
    crochetMode = normalized.view.crochetMode;

    updateStageSize();
    updateUi();
    queueDraw();

    if (announce) {
      saveProgress();
      ui.status.textContent = "Progress imported";
      applyAutomaticChartMovement();
    }
  }

  function capturePosition() {
    return {
      row: currentRow,
      segment: currentSegment,
      stitch: currentStitch
    };
  }

  function pushUndo(label, keys) {
    if (suppressUndo || !keys.length) return;

    const seen = new Set();
    const changes = [];

    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push({
        key,
        wasCompleted: completed.has(key)
      });
    }

    undoStack.push({
      label,
      changes,
      position: capturePosition()
    });

    if (undoStack.length > MAX_UNDO_ACTIONS) {
      undoStack.shift();
    }

    updateUndoButtons();
  }

  function undoLastAction() {
    const action = undoStack.pop();
    if (!action) return;

    suppressUndo = true;

    try {
      for (const change of action.changes) {
        if (change.wasCompleted) completed.add(change.key);
        else completed.delete(change.key);
      }

      currentRow = action.position.row;
      currentSegment = action.position.segment;
      currentStitch = action.position.stitch;
    } finally {
      suppressUndo = false;
    }

    updateUi();
    queueDraw();
    saveProgress();

    applyAutomaticChartMovement();
    ui.status.textContent = `Undid ${action.label}`;
  }

  function setCurrent(
    row,
    segment,
    stitch = null,
    scroll = false
  ) {
    currentRow = clamp(
      Math.round(Number(row) || 1),
      1,
      chart.dimensions.rows
    );
    currentSegment = clamp(
      Math.round(Number(segment) || 1),
      1,
      segmentCount()
    );
    currentStitch = normalizeCurrentStitch(
      stitch == null
        ? segmentBounds(currentSegment).start
        : stitch
    );

    updateUi();
    queueDraw();
    saveProgress();

    if (scroll) {
      applyAutomaticChartMovement();
    }
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

    const row =
      Math.floor(linear / segmentCount()) + 1;
    const segment =
      linear % segmentCount() + 1;
    const bounds = segmentBounds(segment);

    setCurrent(row, segment, bounds.start, true);
  }

  function moveRow(delta) {
    setCurrent(
      currentRow + delta,
      currentSegment,
      currentStitch,
      true
    );
  }

  function moveStitch(delta) {
    const total = chart.dimensions.rows *
      chart.dimensions.stitchesPerRow;

    let linear =
      (currentRow - 1) *
      chart.dimensions.stitchesPerRow +
      (currentStitch - 1) +
      delta;

    linear = clamp(linear, 0, total - 1);
    const row =
      Math.floor(linear / chart.dimensions.stitchesPerRow) + 1;
    const stitch =
      linear % chart.dimensions.stitchesPerRow + 1;
    const segment = segmentForStitch(stitch);

    setCurrent(row, segment, stitch, true);
  }

  function setKeysComplete(keys, done, label) {
    pushUndo(label, keys);

    for (const key of keys) {
      if (done) completed.add(key);
      else completed.delete(key);
    }

    updateUi();
    queueDraw();
    saveProgress();
  }

  function currentSegmentKeys() {
    const bounds = segmentBounds(currentSegment);
    const keys = [];

    for (
      let stitch = bounds.start;
      stitch <= bounds.end;
      stitch += 1
    ) {
      keys.push(cellKey(currentRow, stitch));
    }

    return keys;
  }

  function currentRowKeys() {
    const keys = [];

    for (
      let stitch = 1;
      stitch <= chart.dimensions.stitchesPerRow;
      stitch += 1
    ) {
      keys.push(cellKey(currentRow, stitch));
    }

    return keys;
  }

  function toggleCurrentSegment() {
    setKeysComplete(
      currentSegmentKeys(),
      !isCurrentSegmentComplete(),
      "segment change"
    );
  }

  function completeAndNext() {
    const keys = currentSegmentKeys();
    pushUndo("complete segment and advance", keys);

    for (const key of keys) completed.add(key);

    moveSegment(1);
  }

  function toggleCurrentStitch() {
    const key = cellKey(currentRow, currentStitch);
    setKeysComplete(
      [key],
      !completed.has(key),
      "stitch change"
    );
  }

  function completeStitchAndNext() {
    const key = cellKey(currentRow, currentStitch);
    pushUndo("complete stitch and advance", [key]);
    completed.add(key);
    moveStitch(1);
  }

  function setRowComplete(done) {
    setKeysComplete(
      currentRowKeys(),
      done,
      done ? "complete row" : "clear row"
    );
  }

  function resetAllProgress() {
    const keys = [...completed];
    pushUndo("reset all progress", keys);
    completed.clear();
    currentRow = 1;
    currentSegment = 1;
    currentStitch = 1;

    updateUi();
    queueDraw();
    saveProgress();
    applyAutomaticChartMovement();
  }

  function scrollToCurrentSegment(behavior = "smooth") {
    const rect = currentSegmentRectangle();
    const segmentCenterX = rect.x + rect.width / 2;
    const segmentCenterY = rect.y + rect.height / 2;

    const maximumLeft = Math.max(
      0,
      chart.dimensions.stitchesPerRow * cellSize -
        viewport.clientWidth
    );
    const maximumTop = Math.max(
      0,
      displayRowCount() * cellSize -
        viewport.clientHeight
    );

    const targetLeft = clamp(
      segmentCenterX - viewport.clientWidth / 2,
      0,
      maximumLeft
    );
    const targetTop = clamp(
      segmentCenterY - viewport.clientHeight / 2,
      0,
      maximumTop
    );

    viewport.scrollTo({
      left: targetLeft,
      top: targetTop,
      behavior
    });
  }

  function ensureCurrentSegmentVisible(behavior = "smooth") {
    const rect = currentSegmentRectangle();
    const margin = Math.min(32, Math.max(12, cellSize * 0.5));
    const currentLeft = viewport.scrollLeft;
    const currentTop = viewport.scrollTop;
    const visibleRight = currentLeft + viewport.clientWidth;
    const visibleBottom = currentTop + viewport.clientHeight;
    const maximumLeft = Math.max(
      0,
      chart.dimensions.stitchesPerRow * cellSize - viewport.clientWidth
    );
    const maximumTop = Math.max(
      0,
      displayRowCount() * cellSize - viewport.clientHeight
    );

    let targetLeft = currentLeft;
    let targetTop = currentTop;

    if (rect.width + margin * 2 > viewport.clientWidth) {
      targetLeft = rect.x + rect.width / 2 - viewport.clientWidth / 2;
    } else if (rect.x < currentLeft + margin) {
      targetLeft = rect.x - margin;
    } else if (rect.x + rect.width > visibleRight - margin) {
      targetLeft = rect.x + rect.width - viewport.clientWidth + margin;
    }

    if (rect.y < currentTop + margin) {
      targetTop = rect.y - margin;
    } else if (rect.y + rect.height > visibleBottom - margin) {
      targetTop = rect.y + rect.height - viewport.clientHeight + margin;
    }

    targetLeft = clamp(targetLeft, 0, maximumLeft);
    targetTop = clamp(targetTop, 0, maximumTop);

    if (
      Math.abs(targetLeft - currentLeft) > 1 ||
      Math.abs(targetTop - currentTop) > 1
    ) {
      viewport.scrollTo({
        left: targetLeft,
        top: targetTop,
        behavior
      });
    }
  }

  function applyAutomaticChartMovement(behavior = "smooth") {
    if (scrollMode === "center") {
      scrollToCurrentSegment(behavior);
    } else if (scrollMode === "visible") {
      ensureCurrentSegmentVisible(behavior);
    }
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
      if (centerCurrent) applyAutomaticChartMovement("auto");
      saveProgress();
    });
  }

  function fitCurrentSegment() {
    const availableWidth = Math.max(
      200,
      viewport.clientWidth - 80
    );
    const availableHeight = Math.max(
      90,
      viewport.clientHeight - 110
    );
    const byWidth = availableWidth / (segmentSize + 1);
    const byHeight = availableHeight / 3.25;

    changeZoom(Math.min(byWidth, byHeight, MAX_CELL_SIZE), false);
    requestAnimationFrame(() => scrollToCurrentSegment("auto"));
  }

  function fitWholeChart() {
    const availableWidth = Math.max(
      200,
      viewport.clientWidth - 8
    );
    const availableHeight = Math.max(
      200,
      viewport.clientHeight - 8
    );
    const byWidth =
      availableWidth / chart.dimensions.stitchesPerRow;
    const byHeight =
      availableHeight / displayRowCount();

    changeZoom(Math.min(byWidth, byHeight), false);
    viewport.scrollTo({
      left: 0,
      top: 0,
      behavior: "auto"
    });
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
        "Tap any cell to select that exact stitch";
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
      `Row ${cell.row} · Stitch ${cell.stitch} · ` +
      `Segment ${segment} (${bounds.start}–${bounds.end})`;
  }

  function clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function buildLegend() {
    clearElement(ui.colorLegend);

    for (const [key, palette] of Object.entries(chart.palette)) {
      const item = document.createElement("div");
      item.className = "legend-color";

      const chip = document.createElement("span");
      chip.className = "legend-chip";
      chip.style.background = palette.hex;
      chip.setAttribute("aria-label", palette.name);

      const label = document.createElement("span");
      label.textContent =
        `${palette.name} (${palette.hex}) · palette ${key}`;

      item.append(chip, label);
      ui.colorLegend.appendChild(item);
    }
  }

  function buildYarnColorEditor() {
    clearElement(ui.yarnColorEditor);

    for (const [key, palette] of Object.entries(chart.palette)) {
      const row = document.createElement("div");
      row.className = "yarn-color-row";
      row.dataset.paletteKey = key;

      const keyLabel = document.createElement("strong");
      keyLabel.textContent =
        key === "0"
          ? "Color A"
          : key === "1"
            ? "Color B"
            : `Color ${key}`;

      const nameLabel = document.createElement("label");
      nameLabel.textContent = "Name";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.maxLength = 80;
      nameInput.value = palette.name;
      nameInput.dataset.role = "name";
      nameLabel.appendChild(nameInput);

      const colorLabel = document.createElement("label");
      colorLabel.textContent = "Color";
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = palette.hex;
      colorInput.dataset.role = "color";
      colorLabel.appendChild(colorInput);

      row.append(keyLabel, nameLabel, colorLabel);
      ui.yarnColorEditor.appendChild(row);
    }
  }

  async function saveYarnColors() {
    const updated = JSON.parse(JSON.stringify(chart));

    for (const row of ui.yarnColorEditor.querySelectorAll(
      ".yarn-color-row"
    )) {
      const key = row.dataset.paletteKey;
      const name = row.querySelector('[data-role="name"]').value.trim();
      const hex = row.querySelector('[data-role="color"]').value.toUpperCase();

      updated.palette[key].name =
        name || `Color ${key}`;
      updated.palette[key].hex = hex;
    }

    chart = ProjectStore.validateChart(updated);
    rowsByNumber = new Map(
      chart.rows.map((row) => [row.number, row])
    );
    activeProject =
      await ProjectStore.updateChart(activeProject.id, chart);

    buildLegend();
    buildYarnColorEditor();
    updateUi();
    queueDraw();
    await ProjectStore.flushAutoBackup();
    ui.status.textContent = "Yarn colors saved";
  }

  function loadProjectDetails() {
    const details = activeProject.details || {};
    ui.yarnBrand.value = details.yarnBrand || "";
    ui.hookSize.value = details.hookSize || "";
    ui.gauge.value = details.gauge || "";
    ui.projectStartDate.value = details.startDate || "";
    ui.projectNotes.value = activeProject.notes || "";
    rowNoteEditorRow = 0;
    syncRowNoteEditor();
  }

  async function saveProjectRecord(statusMessage = "Project details saved") {
    clearTimeout(notesSaveTimer);
    activeProject.chart = chart;
    activeProject.progress = progressSnapshot();
    activeProject.updatedAt = new Date().toISOString();
    activeProject = await ProjectStore.put(activeProject);
    ui.status.textContent = statusMessage;
    return activeProject;
  }

  function scheduleProjectRecordSave(
    statusMessage = "Notes saved",
    statusRow = rowNoteEditorRow
  ) {
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => {
      saveProjectRecord(statusMessage)
        .then(() => {
          if (ui.rowNote && rowNoteEditorRow === statusRow) {
            ui.rowNoteStatus.textContent = ui.rowNote.value.trim()
              ? `Saved for row ${statusRow}.`
              : `No note is saved for row ${statusRow}.`;
          }
        })
        .catch((error) => {
          console.warn("Could not save project notes.", error);
          ui.status.textContent = "Notes could not be saved";
          ui.rowNoteStatus.textContent = "The row note could not be saved.";
        });
    }, 650);
  }

  function saveRowNoteValue(rowNumber, value) {
    if (!activeProject.rowNotes || typeof activeProject.rowNotes !== "object") {
      activeProject.rowNotes = {};
    }

    const note = String(value || "").trim();
    if (note) activeProject.rowNotes[String(rowNumber)] = note;
    else delete activeProject.rowNotes[String(rowNumber)];
  }

  function syncRowNoteEditor() {
    if (!activeProject || !ui.rowNote) return;

    if (rowNoteEditorRow !== currentRow) {
      rowNoteEditorRow = currentRow;
      ui.rowNoteNumber.textContent = String(currentRow);
      ui.rowNote.value = activeProject.rowNotes?.[String(currentRow)] || "";
      ui.rowNoteStatus.textContent = ui.rowNote.value
        ? "A note is saved for this row."
        : "No note is saved for this row.";
    }
  }

  async function saveProjectDetails() {
    activeProject.details = {
      yarnBrand: ui.yarnBrand.value,
      hookSize: ui.hookSize.value,
      gauge: ui.gauge.value,
      startDate: ui.projectStartDate.value
    };
    activeProject.notes = ui.projectNotes.value;
    await saveProjectRecord("Project details saved");
    await ProjectStore.flushAutoBackup();
  }

  async function saveCurrentRowNote() {
    saveRowNoteValue(currentRow, ui.rowNote.value);
    await saveProjectRecord(`Row ${currentRow} note saved`);
    ui.rowNoteStatus.textContent = ui.rowNote.value.trim()
      ? `Saved for row ${currentRow}.`
      : `No note is saved for row ${currentRow}.`;
  }

  async function clearCurrentRowNote() {
    ui.rowNote.value = "";
    saveRowNoteValue(currentRow, "");
    await saveProjectRecord(`Row ${currentRow} note cleared`);
    ui.rowNoteStatus.textContent = `No note is saved for row ${currentRow}.`;
  }

  function wakeLockSupported() {
    return "wakeLock" in navigator && typeof navigator.wakeLock?.request === "function";
  }

  function updateWakeLockStatus() {
    if (!wakeLockSupported()) {
      ui.keepScreenAwake.disabled = true;
      ui.wakeLockStatus.textContent =
        "This browser does not support keeping the screen awake.";
      return;
    }

    ui.keepScreenAwake.disabled = false;
    if (!keepScreenAwake) {
      ui.wakeLockStatus.textContent = "The screen may sleep normally.";
    } else if (wakeLockSentinel) {
      ui.wakeLockStatus.textContent = "Screen awake is active while this page is visible.";
    } else if (document.visibilityState !== "visible") {
      ui.wakeLockStatus.textContent = "Screen awake will resume when the viewer is visible.";
    } else {
      ui.wakeLockStatus.textContent = "Screen awake is enabled and waiting to reconnect.";
    }
  }

  async function requestScreenWakeLock() {
    if (
      !keepScreenAwake ||
      !wakeLockSupported() ||
      wakeLockSentinel ||
      document.visibilityState !== "visible"
    ) {
      updateWakeLockStatus();
      return;
    }

    try {
      wakeLockSentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinel.addEventListener("release", () => {
        wakeLockSentinel = null;
        updateWakeLockStatus();
      }, { once: true });
      updateWakeLockStatus();
    } catch (error) {
      console.warn("Screen wake lock could not be enabled.", error);
      wakeLockSentinel = null;
      ui.wakeLockStatus.textContent =
        `Screen awake could not start: ${error.message}`;
    }
  }

  async function releaseScreenWakeLock() {
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    if (sentinel) {
      try {
        await sentinel.release();
      } catch (error) {
        console.warn("Screen wake lock could not be released cleanly.", error);
      }
    }
    updateWakeLockStatus();
  }

  async function applyWakeLockPreference() {
    if (keepScreenAwake) await requestScreenWakeLock();
    else await releaseScreenWakeLock();
    saveProgress();
  }

  const lockSensitiveControlIds = [
    "segmentSizeInput",
    "applySegmentSize",
    "toggleSegment",
    "completeNext",
    "toggleStitch",
    "completeStitchNext",
    "completeRow",
    "clearRow",
    "resetProgress",
    "importProgress",
    "saveYarnColors",
    "saveProjectDetails",
    "saveRowNote",
    "clearRowNote"
  ];

  function updateInteractionLockUi() {
    document.body.classList.toggle("interaction-locked", controlsLocked);
    const label = controlsLocked ? "Unlock Controls" : "Lock Controls";
    const shortLabel = controlsLocked ? "Unlock" : "Lock";

    ui.topInteractionLock.textContent = label;
    ui.sidebarInteractionLock.textContent =
      controlsLocked ? "Unlock accidental-tap protection" : "Lock accidental taps";
    ui.mobileInteractionLock.textContent = shortLabel;

    for (const button of [
      ui.topInteractionLock,
      ui.sidebarInteractionLock,
      ui.mobileInteractionLock
    ]) {
      button.setAttribute("aria-pressed", String(controlsLocked));
    }

    for (const id of lockSensitiveControlIds) {
      const control = $(id);
      if (control) control.disabled = controlsLocked;
    }

    canvas.setAttribute(
      "aria-description",
      controlsLocked
        ? "Chart selection is locked. Scrolling remains available."
        : "Tap a chart cell to select its exact stitch."
    );
  }

  function toggleInteractionLock() {
    if (
      controlsLocked &&
      !confirm("Unlock chart selection and editing controls?")
    ) {
      return;
    }

    controlsLocked = !controlsLocked;
    updateInteractionLockUi();
    updateUndoButtons();
    ui.status.textContent = controlsLocked
      ? "Accidental-tap protection is on. Scrolling and Complete & Next remain available."
      : "Controls unlocked";
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
      ui.backupStatusChip.textContent =
        "Auto-backup not connected";
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
      ui.backupStatusChip.textContent =
        "Backup needs permission";
      return;
    }

    ui.backupStatusChip.classList.add("success");
    ui.backupStatusChip.textContent = status.lastSavedAt
      ? `Backed up ${formatBackupTime(status.lastSavedAt)}`
      : "Auto-backup connected";
  }

  async function backupLibraryNow() {
    saveRowNoteValue(rowNoteEditorRow || currentRow, ui.rowNote.value);
    await saveProjectRecord("Project saved");
    const status = currentBackupStatus;

    if (!status?.supported) {
      alert(
        "Automatic file backup is not available in this browser. Return to Projects and use Download Backup."
      );
      return;
    }

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
    const nextDpr = Math.min(
      window.devicePixelRatio || 1,
      MAX_DPR
    );

    if (Math.abs(nextDpr - dpr) > 0.01) {
      dpr = nextDpr;
      lastCanvasCssWidth = 0;
      lastCanvasCssHeight = 0;
      updateUi();
      queueDraw();
    }
  }

  function toggleCrochetMode() {
    crochetMode = !crochetMode;
    updateUi();
    saveProgress();

    if (crochetMode) {
      requestAnimationFrame(() => {
        scrollToCurrentSegment("auto");
      });
    }
  }

  function bindEvents() {
    $("changeProject").addEventListener("click", async () => {
      saveRowNoteValue(rowNoteEditorRow || currentRow, ui.rowNote.value);
      await saveProjectRecord("Project saved");
      await ProjectStore.flushAutoBackup();
      window.location.href = "index.html";
    });

    $("newProject").addEventListener("click", async () => {
      saveRowNoteValue(rowNoteEditorRow || currentRow, ui.rowNote.value);
      await saveProjectRecord("Project saved");
      await ProjectStore.flushAutoBackup();
      window.location.href = "index.html?new=1";
    });

    $("toggleCrochetMode").addEventListener(
      "click",
      toggleCrochetMode
    );
    ui.undoAction.addEventListener("click", undoLastAction);
    ui.mobileUndo.addEventListener("click", undoLastAction);
    ui.topInteractionLock.addEventListener("click", toggleInteractionLock);
    ui.sidebarInteractionLock.addEventListener("click", toggleInteractionLock);
    ui.mobileInteractionLock.addEventListener("click", toggleInteractionLock);

    $("exportProject").addEventListener("click", async () => {
      try {
        saveRowNoteValue(rowNoteEditorRow || currentRow, ui.rowNote.value);
        await saveProjectRecord("Project saved");
        await ProjectStore.downloadProject(activeProject.id);
      } catch (error) {
        alert(`Could not export this project: ${error.message}`);
      }
    });

    $("backupNow").addEventListener("click", () => {
      backupLibraryNow().catch((error) => {
        if (error?.name === "AbortError") return;

        console.error(error);
        alert(`Could not update the backup: ${error.message}`);
      });
    });

    $("previousSegment").addEventListener(
      "click",
      () => moveSegment(-1)
    );
    $("nextSegment").addEventListener(
      "click",
      () => moveSegment(1)
    );
    $("toggleSegment").addEventListener(
      "click",
      toggleCurrentSegment
    );
    $("completeNext").addEventListener(
      "click",
      completeAndNext
    );

    $("previousStitch").addEventListener(
      "click",
      () => moveStitch(-1)
    );
    $("nextStitch").addEventListener(
      "click",
      () => moveStitch(1)
    );
    $("toggleStitch").addEventListener(
      "click",
      toggleCurrentStitch
    );
    $("completeStitchNext").addEventListener(
      "click",
      completeStitchAndNext
    );

    $("mobilePrevious").addEventListener(
      "click",
      () => moveStitch(-1)
    );
    $("mobileNext").addEventListener(
      "click",
      () => moveStitch(1)
    );
    $("mobileCompleteNext").addEventListener(
      "click",
      completeStitchAndNext
    );

    $("applySegmentSize").addEventListener("click", () => {
      applySegmentSizeChange(
        ui.segmentSizeInput.value,
        true
      );
    });

    ui.segmentSizeInput.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          applySegmentSizeChange(
            ui.segmentSizeInput.value,
            true
          );
        }
      }
    );

    ui.segmentSizeInput.addEventListener("change", () => {
      applySegmentSizeChange(
        ui.segmentSizeInput.value,
        true
      );
    });

    $("jumpButton").addEventListener("click", () => {
      const segment =
        Number(ui.jumpSegment.value);
      setCurrent(
        Number(ui.jumpRow.value),
        segment,
        segmentBounds(segment).start,
        true
      );
    });

    $("completeRow").addEventListener(
      "click",
      () => setRowComplete(true)
    );
    $("clearRow").addEventListener(
      "click",
      () => setRowComplete(false)
    );
    $("scrollCurrent").addEventListener(
      "click",
      () => scrollToCurrentSegment()
    );
    $("fitSegment").addEventListener(
      "click",
      fitCurrentSegment
    );
    $("fitWidth").addEventListener(
      "click",
      fitWholeChart
    );
    $("exportProgress").addEventListener(
      "click",
      exportProgress
    );
    $("saveYarnColors").addEventListener(
      "click",
      () => {
        saveYarnColors().catch((error) => {
          console.error(error);
          alert(`Could not save yarn colors: ${error.message}`);
        });
      }
    );
    $("saveProjectDetails").addEventListener("click", () => {
      saveProjectDetails().catch((error) => {
        console.error(error);
        alert(`Could not save project details: ${error.message}`);
      });
    });
    $("saveRowNote").addEventListener("click", () => {
      saveCurrentRowNote().catch((error) => {
        console.error(error);
        alert(`Could not save the row note: ${error.message}`);
      });
    });
    $("clearRowNote").addEventListener("click", () => {
      clearCurrentRowNote().catch((error) => {
        console.error(error);
        alert(`Could not clear the row note: ${error.message}`);
      });
    });
    ui.rowNote.addEventListener("input", () => {
      saveRowNoteValue(currentRow, ui.rowNote.value);
      ui.rowNoteStatus.textContent = "Saving…";
      scheduleProjectRecordSave(
        `Row ${currentRow} note saved`,
        currentRow
      );
    });

    $("zoomOut").addEventListener(
      "click",
      () => changeZoom(cellSize - 6)
    );
    $("zoomIn").addEventListener(
      "click",
      () => changeZoom(cellSize + 6)
    );

    $("resetProgress").addEventListener("click", () => {
      if (!confirm(
        `Clear all progress for "${activeProject.name}"? This can be undone until the page is closed.`
      )) {
        return;
      }

      resetAllProgress();
    });

    $("importProgress").addEventListener(
      "change",
      async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
          applyProgress(JSON.parse(await file.text()));
        } catch (error) {
          alert(error.message);
        }

        event.target.value = "";
      }
    );

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
    ui.scrollMode.addEventListener("change", () => {
      scrollMode = ui.scrollMode.value;
      saveProgress();
      applyAutomaticChartMovement();
    });
    ui.keepScreenAwake.addEventListener("change", () => {
      keepScreenAwake = ui.keepScreenAwake.checked;
      applyWakeLockPreference().catch((error) => {
        console.warn("Could not update screen-awake mode.", error);
      });
    });

    viewport.addEventListener(
      "scroll",
      queueDraw,
      { passive: true }
    );

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
      } else if (keepScreenAwake) {
        requestScreenWakeLock().catch(() => {});
      }
    });

    window.addEventListener("pagehide", () => {
      clearTimeout(notesSaveTimer);
      if (rowNoteEditorRow >= 1) {
        saveRowNoteValue(rowNoteEditorRow, ui.rowNote.value);
      }
      releaseScreenWakeLock().catch(() => {});
      if (chart && activeProject) {
        ProjectStore.saveRecoveryProgress(
          activeProject.id,
          progressSnapshot(),
          chart
        );
      }
    });

    canvas.addEventListener("mousemove", (event) => {
      updateHover(eventCell(event));
    });
    canvas.addEventListener(
      "mouseleave",
      () => updateHover(null)
    );

    canvas.addEventListener("click", (event) => {
      if (controlsLocked) {
        ui.status.textContent = "Chart selection is locked. Use Unlock Controls to change the selected stitch.";
        return;
      }
      const cell = eventCell(event);
      if (!cell || cell.row === 0) return;

      setCurrent(
        cell.row,
        segmentForStitch(cell.stitch),
        cell.stitch,
        true
      );
    });

    document.addEventListener("keydown", (event) => {
      const tag = document.activeElement?.tagName;

      if (
        ["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(tag)
      ) {
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        if (!controlsLocked) undoLastAction();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveStitch(-1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveStitch(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveRow(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveRow(-1);
      } else if (event.key === " ") {
        event.preventDefault();
        if (!controlsLocked) toggleCurrentStitch();
      } else if (event.key === "Enter") {
        event.preventDefault();
        completeStitchAndNext();
      } else if (event.key === "[") {
        event.preventDefault();
        moveSegment(-1);
      } else if (event.key === "]") {
        event.preventDefault();
        moveSegment(1);
      }
    });
  }

  async function init() {
    try {
      chart = await loadProjectChart();
      rowsByNumber = new Map(
        chart.rows.map((row) => [row.number, row])
      );

      ui.projectName.textContent = activeProject.name;
      document.title =
        `${activeProject.name} - Mosaic Crochet Viewer`;
      ui.jumpRow.max = String(chart.dimensions.rows);
      ui.jumpSegment.max = String(segmentCount());
      ui.segmentTotal.textContent =
        String(segmentCount());

      ui.status.textContent = "Project ready";
      ProjectStore.onAutoBackupStatus(renderBackupStatus);
      await ProjectStore.getAutoBackupStatus();

      buildLegend();
      buildYarnColorEditor();
      restoreProgress();
      loadProjectDetails();
      bindEvents();
      updateStageSize();
      updateUi();
      queueDraw();
      if (keepScreenAwake) {
        requestScreenWakeLock().catch(() => {});
      }

      setTimeout(() => {
        applyAutomaticChartMovement("auto");
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
