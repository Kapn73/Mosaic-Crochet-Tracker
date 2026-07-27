(() => {
  "use strict";

  const LATIN1_CHUNK = 0x8000;
  const NUMBER = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)";
  const MAX_CELLS = 200000;

  class StitchFiddleImportError extends Error {
    constructor(message, code = "STITCH_FIDDLE_IMPORT_ERROR") {
      super(message);
      this.name = "StitchFiddleImportError";
      this.code = code;
    }
  }

  function bytesToLatin1(bytes) {
    let output = "";
    for (let offset = 0; offset < bytes.length; offset += LATIN1_CHUNK) {
      output += String.fromCharCode(...bytes.subarray(offset, offset + LATIN1_CHUNK));
    }
    return output;
  }

  function latin1ToBytes(text) {
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) {
      bytes[index] = text.charCodeAt(index) & 0xff;
    }
    return bytes;
  }

  function normalizeNumber(value) {
    const number = Number(value);
    return Object.is(number, -0) ? 0 : number;
  }

  function roundCoordinate(value) {
    return Number(Number(value).toFixed(2));
  }

  function fillKey(rgb) {
    return rgb.map((value) => Number(value).toFixed(3)).join(",");
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, Number(value)));
  }

  function cmykToRgb(c, m, y, k) {
    return [
      1 - Math.min(1, c * (1 - k) + k),
      1 - Math.min(1, m * (1 - k) + k),
      1 - Math.min(1, y * (1 - k) + k),
    ];
  }

  function rgbToHex(rgb) {
    return `#${rgb
      .map((value) => Math.round(clamp01(value) * 255).toString(16).padStart(2, "0"))
      .join("")}`.toUpperCase();
  }

  function rgbToArray(rgb) {
    return rgb.map((value) => Math.round(clamp01(value) * 255));
  }

  function colorDistance(left, right) {
    return Math.sqrt(
      left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0)
    );
  }

  function decodePdfLiteral(raw) {
    let output = "";
    for (let index = 0; index < raw.length; index += 1) {
      const character = raw[index];
      if (character !== "\\") {
        output += character;
        continue;
      }

      const next = raw[index + 1];
      if (next === undefined) break;

      const simple = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        "(": "(",
        ")": ")",
        "\\": "\\",
      };

      if (Object.prototype.hasOwnProperty.call(simple, next)) {
        output += simple[next];
        index += 1;
        continue;
      }

      if (/[0-7]/.test(next)) {
        let octal = next;
        let consumed = 1;
        while (consumed < 3 && /[0-7]/.test(raw[index + 1 + consumed] || "")) {
          octal += raw[index + 1 + consumed];
          consumed += 1;
        }
        output += String.fromCharCode(parseInt(octal, 8));
        index += consumed;
        continue;
      }

      if (next === "\r" || next === "\n") {
        if (next === "\r" && raw[index + 2] === "\n") index += 1;
        index += 1;
        continue;
      }

      output += next;
      index += 1;
    }
    return output;
  }

  function objectIndex(bytes) {
    const text = bytesToLatin1(bytes);
    const starts = [];
    const regex = /(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b/g;
    let match;

    while ((match = regex.exec(text))) {
      const prefix = match[0].startsWith("\r") || match[0].startsWith("\n") ? 1 : 0;
      starts.push({
        number: Number(match[1]),
        generation: Number(match[2]),
        start: match.index + prefix,
        bodyStart: regex.lastIndex,
      });
    }

    if (!starts.length) {
      throw new StitchFiddleImportError(
        "This file does not appear to be a readable PDF.",
        "PDF_OBJECTS_NOT_FOUND"
      );
    }

    const objects = new Map();
    for (let index = 0; index < starts.length; index += 1) {
      const current = starts[index];
      const end = index + 1 < starts.length ? starts[index + 1].start : text.length;
      objects.set(current.number, {
        ...current,
        end,
        text: text.slice(current.bodyStart, end),
      });
    }

    return { text, objects, ordered: starts.map((item) => objects.get(item.number)) };
  }

  function streamBytes(pdfBytes, object) {
    const objectText = object.text;
    const streamMatch = /stream(?:\r\n|\n|\r)/.exec(objectText);
    if (!streamMatch) return null;

    const dictionary = objectText.slice(0, streamMatch.index);
    const start = object.bodyStart + streamMatch.index + streamMatch[0].length;
    const directLength = /\/Length\s+(\d+)\b/.exec(dictionary);

    if (directLength) {
      const length = Number(directLength[1]);
      return {
        dictionary,
        bytes: pdfBytes.slice(start, start + length),
      };
    }

    const endRelative = objectText.indexOf("endstream", streamMatch.index + streamMatch[0].length);
    if (endRelative < 0) {
      throw new StitchFiddleImportError(
        "A PDF content stream could not be read.",
        "PDF_STREAM_END_NOT_FOUND"
      );
    }

    let end = object.bodyStart + endRelative;
    while (end > start && (pdfBytes[end - 1] === 10 || pdfBytes[end - 1] === 13)) end -= 1;
    return { dictionary, bytes: pdfBytes.slice(start, end) };
  }

  function inflateStream(stream) {
    if (!globalThis.pako?.inflate) {
      throw new StitchFiddleImportError(
        "The PDF decompression library did not load.",
        "PDF_DECOMPRESSION_UNAVAILABLE"
      );
    }

    try {
      return globalThis.pako.inflate(stream);
    } catch (error) {
      throw new StitchFiddleImportError(
        `The Stitch Fiddle chart stream could not be decompressed: ${error.message}`,
        "PDF_DECOMPRESSION_FAILED"
      );
    }
  }

  function decodeObjectStream(pdfBytes, object) {
    const stream = streamBytes(pdfBytes, object);
    if (!stream) return "";

    let decoded = stream.bytes;
    if (/\/FlateDecode\b/.test(stream.dictionary)) {
      decoded = inflateStream(decoded);
    } else if (/\/Filter\b/.test(stream.dictionary)) {
      throw new StitchFiddleImportError(
        "This PDF uses a compression format that this importer does not support.",
        "UNSUPPORTED_PDF_FILTER"
      );
    }

    return bytesToLatin1(decoded);
  }

  function contentReferences(pageText) {
    const arrayMatch = /\/Contents\s*\[([^\]]+)\]/s.exec(pageText);
    if (arrayMatch) {
      return [...arrayMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]));
    }

    const single = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pageText);
    return single ? [Number(single[1])] : [];
  }

  function pageContents(pdfBytes, index) {
    const pages = index.ordered.filter(
      (object) => /\/Type\s*\/Page\b/.test(object.text) && !/\/Type\s*\/Pages\b/.test(object.text)
    );

    if (!pages.length) {
      throw new StitchFiddleImportError(
        "No PDF pages were found.",
        "PDF_PAGES_NOT_FOUND"
      );
    }

    return pages.map((page, pageIndex) => {
      const references = contentReferences(page.text);
      const content = references
        .map((reference) => {
          const object = index.objects.get(reference);
          return object ? decodeObjectStream(pdfBytes, object) : "";
        })
        .join("\n");

      return { pageNumber: pageIndex + 1, content };
    });
  }

  function parseDrawingContent(content) {
    const lines = content.split(/\r\n|\n|\r/);
    const rectangles = [];
    let currentFill = [0, 0, 0];
    let lastRectangle = null;

    const rgbPattern = new RegExp(`^\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+rg\\s*$`);
    const grayPattern = new RegExp(`^\\s*(${NUMBER})\\s+g\\s*$`);
    const cmykPattern = new RegExp(`^\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+k\\s*$`);
    const rectanglePattern = new RegExp(`^\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+re\\s+(?:B|b|f|f\\*)\\s*$`);

    for (const line of lines) {
      let match = rgbPattern.exec(line);
      if (match) {
        currentFill = [Number(match[1]), Number(match[2]), Number(match[3])];
        continue;
      }

      match = grayPattern.exec(line);
      if (match) {
        const gray = Number(match[1]);
        currentFill = [gray, gray, gray];
        continue;
      }

      match = cmykPattern.exec(line);
      if (match) {
        currentFill = cmykToRgb(
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
          Number(match[4])
        );
        continue;
      }

      match = rectanglePattern.exec(line);
      if (match) {
        lastRectangle = {
          x: normalizeNumber(match[1]),
          y: normalizeNumber(match[2]),
          width: normalizeNumber(match[3]),
          height: normalizeNumber(match[4]),
          fill: [...currentFill],
          glyph: null,
        };
        rectangles.push(lastRectangle);
        continue;
      }

      if (lastRectangle && lastRectangle.glyph === null && /\bTj\b/.test(line)) {
        const literalMatch = /\(((?:\\.|[^\\)])*)\)\s*Tj\b/.exec(line);
        if (literalMatch) {
          lastRectangle.glyph = decodePdfLiteral(literalMatch[1]);
        }
      }
    }

    return rectangles;
  }

  function modeCellSize(rectangles) {
    const counts = new Map();
    for (const rectangle of rectangles) {
      const width = Math.abs(rectangle.width).toFixed(2);
      const height = Math.abs(rectangle.height).toFixed(2);
      const key = `${width}|${height}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const selected = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
    if (!selected || selected[1] < 100) {
      throw new StitchFiddleImportError(
        "A Stitch Fiddle cell grid could not be identified in this PDF.",
        "GRID_NOT_FOUND"
      );
    }

    const [width, height] = selected[0].split("|").map(Number);
    return { width, height, count: selected[1] };
  }

  function uniqueSorted(values, direction = "asc") {
    const unique = [...new Set(values.map(roundCoordinate))];
    unique.sort((left, right) => direction === "asc" ? left - right : right - left);
    return unique;
  }

  function slugify(value) {
    const slug = String(value || "stitch-fiddle-chart")
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return slug || "stitch-fiddle-chart";
  }

  function simpleHash(bytes) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < bytes.length; index += Math.max(1, Math.floor(bytes.length / 50000))) {
      hash ^= bytes[index];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function colorFromMarker(cells, glyph) {
    const matches = cells.filter((cell) => cell.glyph === glyph);
    if (!matches.length) return null;

    const counts = new Map();
    for (const cell of matches) {
      const key = fillKey(cell.fill);
      const record = counts.get(key) || { count: 0, fill: cell.fill };
      record.count += 1;
      counts.set(key, record);
    }

    return [...counts.values()].sort((left, right) => right.count - left.count)[0].fill;
  }

  function nearestPaletteCode(fill, colorA, colorB) {
    return colorDistance(fill, colorA) <= colorDistance(fill, colorB) ? "0" : "1";
  }

  function stitchCode(glyph) {
    if (glyph === null || glyph === undefined || glyph === "") return "s";
    if (glyph === " " || glyph === "!") return "d";
    if (glyph === '"' || glyph === "#") return "b";
    if (glyph === "&") return "c";

    throw new StitchFiddleImportError(
      `An unfamiliar Stitch Fiddle symbol (${JSON.stringify(glyph)}) was found.`,
      "UNKNOWN_STITCH_SYMBOL"
    );
  }

  function buildChart(pdfBytes, fileName, content, onProgress) {
    onProgress?.({ stage: "grid", message: "Reading the Stitch Fiddle cell grid…" });

    const rectangles = parseDrawingContent(content);
    const commonSize = modeCellSize(rectangles);
    const gridCells = rectangles.filter(
      (rectangle) =>
        Math.abs(Math.abs(rectangle.width) - commonSize.width) < 0.015 &&
        Math.abs(Math.abs(rectangle.height) - commonSize.height) < 0.015
    );

    const xPositions = uniqueSorted(gridCells.map((cell) => cell.x), "asc");
    const yPositions = uniqueSorted(gridCells.map((cell) => cell.y), "desc");

    if (xPositions.length < 5 || yPositions.length < 2) {
      throw new StitchFiddleImportError(
        "The detected grid is too small to be a Stitch Fiddle mosaic chart.",
        "GRID_TOO_SMALL"
      );
    }

    const stitchesPerRow = xPositions.length - 2;
    const rowCount = yPositions.length - 1;
    const expectedCells = xPositions.length * yPositions.length;

    if (expectedCells > MAX_CELLS) {
      throw new StitchFiddleImportError(
        `This chart contains ${expectedCells.toLocaleString()} grid cells, which is larger than the current importer limit.`,
        "GRID_TOO_LARGE"
      );
    }

    const cellMap = new Map();
    for (const cell of gridCells) {
      cellMap.set(`${roundCoordinate(cell.x)}|${roundCoordinate(cell.y)}`, cell);
    }

    if (cellMap.size !== expectedCells) {
      throw new StitchFiddleImportError(
        `The Stitch Fiddle grid is incomplete: expected ${expectedCells.toLocaleString()} cells but found ${cellMap.size.toLocaleString()}.`,
        "INCOMPLETE_GRID"
      );
    }

    const cellAt = (xIndex, yIndex) => {
      const cell = cellMap.get(`${xPositions[xIndex]}|${yPositions[yIndex]}`);
      if (!cell) {
        throw new StitchFiddleImportError(
          `A chart cell is missing at grid column ${xIndex + 1}, row ${yIndex + 1}.`,
          "MISSING_GRID_CELL"
        );
      }
      return cell;
    };

    const markerCells = [];
    for (let yIndex = 0; yIndex < yPositions.length; yIndex += 1) {
      markerCells.push(cellAt(0, yIndex), cellAt(xPositions.length - 1, yIndex));
    }

    const colorA = colorFromMarker(markerCells, "$");
    const colorB = colorFromMarker(markerCells, "%");

    if (!colorA || !colorB) {
      throw new StitchFiddleImportError(
        "Color A and Color B row markers could not be detected. This importer currently supports default two-color Stitch Fiddle mosaic PDFs.",
        "COLOR_MARKERS_NOT_FOUND"
      );
    }

    if (colorDistance(colorA, colorB) < 0.01) {
      throw new StitchFiddleImportError(
        "Color A and Color B appear to be identical in this PDF.",
        "COLORS_NOT_DISTINCT"
      );
    }

    onProgress?.({
      stage: "convert",
      message: `Converting ${rowCount.toLocaleString()} rows × ${stitchesPerRow.toLocaleString()} stitches…`,
      rows: rowCount,
      stitchesPerRow,
    });

    const rows = [];
    const binaryRows = [];

    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
      const visualYIndex = rowCount - rowNumber;
      const leftMarker = cellAt(0, visualYIndex);
      const rightMarker = cellAt(xPositions.length - 1, visualYIndex);
      const markerGlyph = [leftMarker.glyph, rightMarker.glyph].find((glyph) => glyph === "$" || glyph === "%");

      if (!markerGlyph) {
        throw new StitchFiddleImportError(
          `The working-color marker is missing on chart row ${rowNumber}.`,
          "ROW_COLOR_MARKER_MISSING"
        );
      }

      const visibleCells = [];
      for (let xIndex = 1; xIndex <= stitchesPerRow; xIndex += 1) {
        visibleCells.push(cellAt(xIndex, visualYIndex));
      }

      // The viewer places stitch 1 at the right edge. Reverse the visible PDF
      // row so the imported design is not mirrored.
      const jsonCells = visibleCells.reverse();
      const colors = jsonCells.map((cell) => nearestPaletteCode(cell.fill, colorA, colorB)).join("");
      const stitches = jsonCells.map((cell) => stitchCode(cell.glyph)).join("");

      rows.push({
        number: rowNumber,
        workingColor: markerGlyph === "$" ? "A" : "B",
        colors,
        stitches,
      });
      binaryRows.push(colors);
    }

    const foundationYIndex = yPositions.length - 1;
    const foundationCells = [];
    for (let xIndex = 1; xIndex <= stitchesPerRow; xIndex += 1) {
      foundationCells.push(cellAt(xIndex, foundationYIndex));
    }
    foundationCells.reverse();

    const foundationColors = foundationCells
      .map((cell) => nearestPaletteCode(cell.fill, colorA, colorB))
      .join("");
    const foundationStitches = foundationCells.map((cell) => stitchCode(cell.glyph)).join("");

    if (![...foundationStitches].every((code) => code === "c")) {
      throw new StitchFiddleImportError(
        "The final grid row was not recognized as a complete foundation chain.",
        "FOUNDATION_NOT_RECOGNIZED"
      );
    }

    const baseName = String(fileName || "Stitch Fiddle Chart").replace(/\.pdf$/i, "");
    const looksLikeUuid = /^[0-9a-f-]{24,}$/i.test(baseName.replace(/\s+/g, ""));
    const title = looksLikeUuid
      ? `Stitch Fiddle Chart ${stitchesPerRow} × ${rowCount}`
      : baseName;

    return {
      schemaVersion: 2,
      chartId: `${slugify(baseName)}-${stitchesPerRow}x${rowCount}-${simpleHash(pdfBytes)}`,
      title,
      source: {
        type: "Stitch Fiddle PDF conversion",
        description: "Imported locally from a default two-color Stitch Fiddle mosaic crochet PDF.",
        originalFileName: fileName || "",
        importerVersion: 1,
        orientationCorrection: "PDF rows are reversed horizontally so stitch 1 is displayed at the right edge without mirroring the design.",
      },
      dimensions: {
        rows: rowCount,
        stitchesPerRow,
        foundationRow: 0,
      },
      orientation: {
        jsonRowOrder: `row 1 through row ${rowCount}`,
        jsonStitchOrder: `stitch 1 through stitch ${stitchesPerRow}`,
        chartDisplayTopRow: rowCount,
        chartDisplayBottomRow: 0,
        chartDisplayLeftStitch: stitchesPerRow,
        chartDisplayRightStitch: 1,
      },
      palette: {
        "0": {
          id: 0,
          name: "Color A",
          hex: rgbToHex(colorA),
          rgb: rgbToArray(colorA),
        },
        "1": {
          id: 1,
          name: "Color B",
          hex: rgbToHex(colorB),
          rgb: rgbToArray(colorB),
        },
      },
      stitchCodes: {
        s: "single crochet (blank cell)",
        d: "double crochet (X)",
        b: "border stitch (BS)",
        c: "chain",
      },
      foundation: {
        row: 0,
        workingColor: "A",
        colors: foundationColors,
        stitches: foundationStitches,
      },
      binaryRows,
      rows,
    };
  }

  function validatePdfHeader(bytes) {
    const header = bytesToLatin1(bytes.subarray(0, Math.min(bytes.length, 16)));
    if (!header.startsWith("%PDF-")) {
      throw new StitchFiddleImportError(
        "The selected file is not a PDF.",
        "NOT_A_PDF"
      );
    }
  }

  async function parse(input, options = {}) {
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const fileName = options.fileName || input?.name || "Stitch Fiddle Chart.pdf";

    onProgress?.({ stage: "read", message: "Reading the PDF…" });

    const arrayBuffer = input instanceof ArrayBuffer
      ? input
      : ArrayBuffer.isView(input)
        ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
        : await input.arrayBuffer();

    const bytes = new Uint8Array(arrayBuffer);
    validatePdfHeader(bytes);

    onProgress?.({ stage: "objects", message: "Finding the Stitch Fiddle chart page…" });
    const index = objectIndex(bytes);
    const pages = pageContents(bytes, index);

    const candidates = pages
      .map((page) => ({
        ...page,
        rectangleCount: (page.content.match(/\sre\s+(?:B|b|f|f\*)\b/g) || []).length,
      }))
      .sort((left, right) => right.rectangleCount - left.rectangleCount);

    const chartPage = candidates[0];
    if (!chartPage || chartPage.rectangleCount < 100) {
      throw new StitchFiddleImportError(
        "A default Stitch Fiddle chart page could not be found in this PDF.",
        "CHART_PAGE_NOT_FOUND"
      );
    }

    const chart = buildChart(bytes, fileName, chartPage.content, onProgress);
    onProgress?.({
      stage: "done",
      message: `Ready: ${chart.dimensions.rows.toLocaleString()} rows × ${chart.dimensions.stitchesPerRow.toLocaleString()} stitches.`,
      chart,
      pageNumber: chartPage.pageNumber,
    });

    return chart;
  }

  globalThis.StitchFiddlePDF = {
    parse,
    StitchFiddleImportError,
    version: 1,
  };
})();
