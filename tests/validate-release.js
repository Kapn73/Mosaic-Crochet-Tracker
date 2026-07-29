const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function testRequiredFiles() {
  const required = [
    "index.html",
    "viewer.html",
    "library.css",
    "library.js",
    "viewer.css",
    "viewer.js",
    "project-store.js",
    "stitch-fiddle-pdf.js",
    "vendor/pako_inflate.min.js",
    "demo-geometric-bloom.json",
    "manifest.webmanifest",
    "service-worker.js",
    "pwa.js",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/apple-touch-icon.png",
    "tests/validate-viewer-runtime.js"
  ];

  for (const name of required) {
    assert(
      fs.existsSync(path.join(root, name)),
      `Missing required release file: ${name}`
    );
  }
}

function testManifest() {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert(manifest.start_url === "./", "PWA start_url must be relative.");
  assert(manifest.scope === "./", "PWA scope must be relative.");
  assert(manifest.display === "standalone", "PWA display must be standalone.");
  assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "PWA icons are missing.");
}

function testDemoShape() {
  const demo = JSON.parse(read("demo-geometric-bloom.json"));
  const rows = demo.dimensions.rows;
  const stitches = demo.dimensions.stitchesPerRow;

  assert(demo.rows.length === rows, "Demo row count does not match dimensions.");

  for (const row of demo.rows) {
    assert(row.colors.length === stitches, `Demo row ${row.number} color length is invalid.`);
    assert(row.stitches.length === stitches, `Demo row ${row.number} stitch length is invalid.`);
  }
}

async function testProjectStore() {
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    }
  };

  const window = {
    dispatchEvent() {},
    showSaveFilePicker: undefined
  };

  const context = {
    console,
    window,
    localStorage,
    CustomEvent: function CustomEvent() {},
    crypto: {
      randomUUID() {
        return `test-${Math.random().toString(16).slice(2)}`;
      }
    },
    Blob,
    URL,
    setTimeout,
    clearTimeout,
    atob,
    btoa
  };

  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read("project-store.js"), context, {
    filename: "project-store.js"
  });

  const store = context.window.ProjectStore;
  const demo = JSON.parse(read("demo-geometric-bloom.json"));

  await store.init(demo);
  const seeded = await store.list();
  assert(seeded.length === 1, "The original demo should seed exactly once.");

  const project = await store.create("Validation Project", demo, "demo.json");
  await store.updateProgress(
    project.id,
    {
      completed: ["1:1", "1:2"],
      current: { row: 2, segment: 1, stitch: 2 },
      view: {
        segmentSize: 10,
        scrollMode: "visible",
        keepScreenAwake: true
      }
    },
    demo
  );

  const projectWithNotes = await store.get(project.id);
  projectWithNotes.notes = "Border with three rounds.\nAdd tassels after blocking.";
  projectWithNotes.details = {
    yarnBrand: "Validation Yarn",
    hookSize: "5.5 mm",
    gauge: "14 stitches = 4 inches",
    startDate: "2026-07-28"
  };
  projectWithNotes.rowNotes = {
    "2": "Start a new skein here.",
    "999": "This invalid row must be discarded."
  };
  await store.put(projectWithNotes);

  const restored = await store.get(project.id);
  assert(restored.progress.completed.length === 2, "Progress did not round-trip.");
  assert(restored.progress.current.stitch === 2, "Exact stitch position did not round-trip.");
  assert(restored.progress.view.scrollMode === "visible", "Scroll mode did not round-trip.");
  assert(restored.progress.view.keepScreenAwake === true, "Screen-awake preference did not round-trip.");
  assert(restored.notes.includes("\n"), "Multiline project notes did not preserve line breaks.");
  assert(restored.details.hookSize === "5.5 mm", "Project details did not round-trip.");
  assert(restored.rowNotes["2"] === "Start a new skein here.", "Row notes did not round-trip.");
  assert(!restored.rowNotes["999"], "Invalid row notes were not discarded.");

  const singleProjectBackup = await store.buildProjectBackupPayload(project.id);
  assert(singleProjectBackup.backupType === "mosaic-crochet-project", "Individual project backup type is invalid.");
  assert(singleProjectBackup.projects.length === 1, "Individual project backup must contain one project.");

  const backupFile = {
    size: JSON.stringify(singleProjectBackup).length,
    async text() {
      return JSON.stringify(singleProjectBackup);
    }
  };
  const inspection = await store.inspectBackupFile(backupFile);
  assert(inspection.summary.projectCount === 1, "Individual project backup inspection failed.");

  const beforeMerge = (await store.list()).length;
  const merged = await store.restoreBackupFile(
    backupFile,
    "merge",
    [project.id]
  );
  assert(merged.projects.length === 1, "Selective project merge did not import one project.");
  assert((await store.list()).length === beforeMerge + 1, "Selective project merge changed the wrong number of projects.");

  let emptySelectionRejected = false;
  try {
    await store.restoreBackupFile(backupFile, "merge", []);
  } catch {
    emptySelectionRejected = true;
  }
  assert(emptySelectionRejected, "An empty selective restore must be rejected.");

  const malicious = JSON.parse(JSON.stringify(demo));
  malicious.rows[0].stitches =
    "x" + malicious.rows[0].stitches.slice(1);

  let rejected = false;
  try {
    store.validateChart(malicious);
  } catch {
    rejected = true;
  }

  assert(rejected, "Unknown stitch codes must be rejected.");

  const unsafePalette = JSON.parse(JSON.stringify(demo));
  unsafePalette.palette["0"].hex = "javascript:alert(1)";
  rejected = false;

  try {
    store.validateChart(unsafePalette);
  } catch {
    rejected = true;
  }

  assert(rejected, "Invalid palette colors must be rejected.");
}

function testUsabilityInterface() {
  const viewer = read("viewer.html");
  const library = read("index.html");
  const viewerScript = read("viewer.js");

  for (const id of [
    "scrollMode",
    "segmentStripCanvas",
    "stitchRulerCanvas",
    "projectNotes",
    "rowNote",
    "keepScreenAwake",
    "toggleInteractionLock",
    "exportProject"
  ]) {
    assert(viewer.includes(`id="${id}"`), `Viewer is missing usability control ${id}.`);
  }

  assert(library.includes('id="restoreSelectedCount"'), "Selective restore controls are missing.");
  assert(viewerScript.includes('scrollMode === "visible"'), "Keep-visible scrolling is missing.");
  assert(viewerScript.includes("navigator.wakeLock.request"), "Screen Wake Lock support is missing.");
  assert(viewerScript.includes("drawActiveSegmentStrip"), "Active segment strip rendering is missing.");
  assert(viewerScript.includes("drawStitchRuler"), "Stitch ruler rendering is missing.");
}

async function main() {
  testRequiredFiles();
  testManifest();
  testDemoShape();
  testUsabilityInterface();
  await testProjectStore();
  console.log("Release validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
