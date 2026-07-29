# Mosaic Crochet Project Viewer

A privacy-focused browser app for importing mosaic crochet charts, breaking
large rows into manageable sections, and tracking progress down to the exact
stitch.

The viewer accepts:

- Default two-color Stitch Fiddle overlay mosaic crochet PDF exports
- Compatible Mosaic Crochet Project Viewer JSON files

Supported PDFs are converted directly in the browser. No account, paid
conversion service, server upload, or separate JSON conversion step is
required.

## Start using the viewer

Open the hosted viewer in a modern browser.

1. Select **New Project**.
2. Choose a supported PDF or JSON file.
3. Review the generated chart preview.
4. Use **Flip Horizontally** or **Swap Colors** when needed.
5. Enter a project name.
6. Select **Create Project**.
7. Open the project and begin tracking progress.

A built-in **Geometric Bloom Demo** is included so the viewer can be explored
without importing a personal pattern.

## Main features

### Importing

- Direct import of supported Stitch Fiddle PDF exports
- Import of compatible JSON chart files
- Local PDF conversion with no pattern upload
- Pre-import chart preview
- Manual horizontal flip and color swap
- Downloadable converted JSON
- Import diagnostics with a copy button
- Strict chart, palette, row, and stitch validation
- 200,000-cell chart safety limit

### Progress tracking

- Multiple named crochet projects
- Exact current row, segment, and stitch
- Adjustable segment sizes from 1 stitch through the full row
- Complete or clear one stitch, one segment, one row, or all progress
- Complete-and-advance controls
- Up to 20 in-session undo actions
- Current and next row color guidance
- Three chart-movement modes: center segment, keep segment visible, or no automatic movement
- Enlarged working-segment strip with exact stitch numbers
- Stitch-number ruler and work-direction guide
- Emergency recovery journal for the latest progress
- Compact progress storage separate from chart data

### Display

- Blank cells displayed as single crochet
- X-marked cells displayed as double crochet
- Border-stitch and foundation-chain support
- Retina-sharp visible-area rendering
- Zoom from 4 to 120 pixels per stitch
- Focus mode that dims everything outside the current segment
- Optional grid, symbols, and foundation row
- Editable yarn names and colors without changing the pattern
- Project details, general notes, and notes for individual rows
- Light and dark mode support

### Mobile and offline use

- iPhone-first Crochet Mode
- Sticky bottom controls on small screens
- Screen-awake option for supported browsers
- Accidental-tap protection that keeps scrolling and Complete & Next available
- Add to Home Screen support
- Progressive Web App manifest and icons
- Offline app-shell caching after the first successful visit
- Update notification when a new release is available

### Backups and library management

- Full-library download and restore
- Individual-project export
- Selective restore of one or more projects from a backup
- Merge or replace when restoring a backup
- Recovery copy created before replacement
- Undo the last full-library restore
- Optional automatic desktop backup to a selected file
- Search, sort, archive, unarchive, duplicate, rename, and delete projects

## Supported Stitch Fiddle PDFs

The PDF importer is designed for the normal free PDF export produced by a
default **two-color Stitch Fiddle overlay mosaic crochet chart**.

A compatible PDF normally includes:

- A Stitch Fiddle legend page
- A vector-based chart page
- Color A and Color B row markers
- Blank single-crochet cells
- X-marked double-crochet cells
- Border-stitch cells
- A complete foundation-chain row

The importer reads the PDF's vector grid and embedded stitch symbols directly.
It does not use OCR and does not estimate cells from a screenshot.

### PDF stitch conversion

| PDF cell or symbol | Internal code | Viewer display |
|---|---:|---|
| Blank chart cell | `s` | Blank single-crochet cell |
| Double-crochet symbol | `d` | X |
| Border-stitch symbol | `b` | BS |
| Foundation-chain symbol | `c` | Chain symbol |

The importer stores stitch 1 on the right to match the viewer's chart
orientation. A visual preview is shown before project creation, and
**Flip Horizontally** remains available for any unusual export.

### PDFs that are not currently supported

The importer stops and reports an error rather than guessing when it finds:

- Scanned chart pages
- Screenshots saved as PDFs
- Print-to-PDF copies that removed the original vector information
- PDFs from unrelated chart programs
- Charts with more than two working colors
- Missing or incomplete chart grids
- Unknown stitch symbols
- Missing foundation chains
- Unsupported PDF stream compression
- Charts above the current 200,000-cell safety limit

Technical details and validation rules are documented in
[PDF_IMPORT.md](PDF_IMPORT.md).

## JSON import

Compatible JSON files can also be imported. JSON is useful for:

- Original chart designs
- Previously converted patterns
- Charts created specifically for this viewer
- Sharing chart data when redistribution is permitted

JSON imports are checked for:

- Valid dimensions
- Complete and unique row numbering
- Exact color and stitch string lengths
- Defined palette keys
- Six-digit hexadecimal colors
- Supported stitch codes only
- Valid working colors
- The same 200,000-cell safety limit used by the PDF importer

The required structure is documented in [JSON_FORMAT.md](JSON_FORMAT.md).

## Privacy

The viewer is a static website with no account system, analytics service,
remote database, or pattern-upload endpoint.

Imported PDFs, converted charts, project names, and progress stay in the
visitor's own browser unless the visitor intentionally downloads or selects a
backup file.

Other visitors to the same public website cannot see:

- Imported pattern PDFs
- Converted chart data
- Project names
- Completed stitches
- Current rows, segments, or stitches
- Backup files

The public repository contains only the application files, documentation,
third-party dependency notices, automated tests, and the original demo chart.

See [PRIVACY.md](PRIVACY.md) for a focused privacy explanation.

## Progress storage and recovery

Projects use IndexedDB when available, with localStorage as a fallback.

Chart records and progress records are stored separately. This means normal
progress changes update a compact bitset and position record rather than
rewriting the entire chart.

Saved progress includes:

- Completed stitches
- Current row, segment, and exact stitch
- Segment size
- Zoom level
- Focus, grid, symbol, and foundation settings
- Working-segment auto-centering preference
- Crochet Mode preference

A small emergency recovery journal is written immediately when progress
changes. It helps recover the latest position if the browser closes before an
IndexedDB save completes.

Browser storage still belongs to a specific browser, device, browser profile,
and website address. Clearing browser data may erase the working copy, so
regular backups remain important.

## Automatic chart movement

The **Automatic chart movement** menu offers three behaviors:

- **Center working segment** moves the chart so the complete active segment is
  centered after navigation.
- **Keep working segment visible** moves only when part of the active segment
  would leave the viewport. This reduces unnecessary chart motion.
- **Do not move automatically** leaves the chart exactly where the visitor
  positioned it.

The **Find current segment** button always centers the active segment once,
regardless of the selected automatic mode.

## Working-segment strip and stitch ruler

A large strip above the chart shows only the current segment. It includes:

- Enlarged chart cells
- Exact stitch numbers
- Double-crochet X symbols
- Completed-stitch shading
- A strong outline around the exact active stitch
- A work-direction arrow

The ruler above the full chart follows horizontal scrolling and labels stitch
numbers at a spacing appropriate for the current zoom. Stitch 1 is shown on
the right and higher stitch numbers continue toward the left.

## Project details and row notes

The **Project details** panel stores optional information such as:

- Yarn brand or line
- Hook size
- Gauge
- Start date
- General project notes

The **Row note** panel follows the active row. Notes can be saved for yarn
changes, corrections, reminders, or any other row-specific information. Row
notes are included in project exports and full-library backups.

## Screen awake and accidental-tap protection

**Keep screen awake while crocheting** requests a screen wake lock when the
browser supports it. The lock is released when the viewer closes and is
reacquired when the visible viewer returns.

**Lock accidental taps** disables chart-cell selection and editing controls
that could change a large amount of progress. Scrolling, stitch navigation,
and the mobile **Complete & Next** button remain available. Unlocking requires
a confirmation.

## Undo

The viewer keeps the latest 20 progress-changing actions during the current
session. Undo supports:

- Stitch changes
- Segment changes
- Row completion or clearing
- Complete-and-advance actions
- Resetting all progress

The undo history is intentionally temporary and is cleared when the viewer
page is closed or reloaded.

## Backups

### Download Backup

**Download Backup** creates one JSON file containing the complete project
library, chart data, positions, settings, and progress.

Store it somewhere safe, such as:

- iCloud Drive
- Google Drive
- OneDrive
- Dropbox
- An external drive
- A normal local folder

### Restore Backup

After a backup is selected, the viewer shows every project it contains.
Select all projects or only the ones that should be restored, then choose:

- **Merge Libraries** keeps current projects and imports the selected backup
  projects. Duplicate IDs and names are adjusted automatically.
- **Replace Library** saves a recovery copy and then replaces the current
  browser library with only the selected projects.

After a replacement, **Undo Last Restore** can swap the current library with
the recovery copy saved before the restore.

### Export one project

Each project card and loaded viewer includes **Export Project**. The downloaded
file contains that chart, progress, yarn display colors, project details, and
row notes. It can be imported through the same **Restore or Import Project**
control used for full-library backups.

### Automatic backup

Supported desktop Chromium browsers can use **Enable Auto-Backup** to select a
normal JSON file that the viewer updates after project changes.

The selected file may be located in a cloud-synced folder such as iCloud Drive
or Google Drive.

Automatic selected-file writing is not available in every browser. Manual
**Download Backup** and **Restore Backup** remain the universal fallback.

## Using the viewer on iPhone

1. Open the hosted viewer in Safari.
2. Select **New Project**.
3. Choose a supported PDF or JSON file from the Files app.
4. Confirm the import preview.
5. Create the project and load it.
6. Select **Crochet Mode** for a chart-first layout.
7. Use **Share → Add to Home Screen** for app-like access.

On small screens, a fixed bottom toolbar provides:

- Previous stitch
- Undo
- Lock or unlock accidental-tap protection
- Current row and stitch
- Complete stitch and advance
- Next stitch

The enlarged working-segment strip and stitch ruler remain visible in Crochet
Mode so the active section can be read without enlarging the full chart.

The Home Screen version still stores projects locally on the iPhone.

Automatic selected-file backup may be unavailable in iPhone Safari. Use
**Download Backup** and save the file in iCloud Drive or another accessible
location.

## Offline use

After the hosted viewer has loaded successfully once, the service worker
caches the application shell. The viewer can then reopen without a network
connection in browsers that support Progressive Web Apps and service workers.

Imported projects are already local. The service worker caches the app code,
not personal PDF files or backup files.

When a new version is published, the viewer displays an update banner. Select
**Update** to activate it.

## Using the same projects on multiple devices

Browser libraries do not automatically synchronize between an iPhone and a
computer.

To continue on another device:

1. Download a fresh backup on the device used most recently.
2. Save it in a shared location such as iCloud Drive.
3. Open the viewer on the second device.
4. Restore or merge that backup before continuing.

Avoid making separate progress on both devices without transferring the latest
backup. Restoring an older file can overwrite newer progress.

## Yarn colors

The **Yarn colors** panel can rename or recolor palette entries after a chart
is imported.

This affects only the viewer's display and saved project data. It does not
change the color layout, row structure, or stitch instructions.

## Project library tools

The project screen supports:

- Search by project name
- Sort by recent use, name, or completion percentage
- Archive completed or inactive projects
- Show or hide archived projects
- Duplicate a project with its current progress
- Export one project with its progress and notes
- Rename and delete projects

## Keyboard controls

When focus is not inside a form control:

| Key | Action |
|---|---|
| Left / Right Arrow | Move between exact stitches |
| Up / Down Arrow | Move between rows |
| Space | Complete or clear the active stitch |
| Enter | Complete the active stitch and advance |
| `[` / `]` | Move between segments |
| Command/Ctrl + Z | Undo the latest progress action |

## Troubleshooting

### A PDF is rejected

Confirm that it is the original default two-color Stitch Fiddle overlay mosaic
crochet PDF export. Scans, screenshots, and print-to-PDF copies may no longer
contain the vector cells and embedded stitch symbols needed by the importer.

Use **Copy Diagnostics** in the import preview when reporting a problem.

### A pattern looks mirrored

Use the import preview's **Flip Horizontally** control before creating the
project. For an already imported project, delete it and import the original
PDF again with the correct preview orientation.

### The colors are reversed

Use **Swap Colors** in the import preview, or edit the yarn names and colors
inside the loaded project.

### Projects disappeared after the site address changed

Browser storage is tied to the exact website address. Restore a complete
library backup at the new address.

### Automatic backup is unavailable

Use **Download Backup** and save the file in a safe location. Automatic backup
depends on browser and file-permission support.

### The website still shows an older version

Reload the page after deployment finishes. Select **Update** when the new
version banner appears. A hard refresh may be needed if an older service worker
or browser cache remains active.

## For repository owners and self-hosters

This project is a static site and requires no build command or server-side
code.

### GitHub Pages deployment

1. Upload all files and folders to the repository root.
2. Confirm that `index.html`, `stitch-fiddle-pdf.js`, `service-worker.js`,
   `manifest.webmanifest`, `icons/`, and `vendor/` are present.
3. Commit the files to the `main` branch.
4. Open **Settings → Pages**.
5. Choose **Deploy from a branch**.
6. Select `main` and `/ (root)`.
7. Save the Pages configuration.

The included `.nojekyll` file allows GitHub Pages to serve the project as a
plain static site.

### Updating an existing deployment

1. Create a full-library backup before updating.
2. Replace the repository files with the new release.
3. Keep the same repository and GitHub Pages address when possible.
4. Commit the updated files.
5. Reload the site after deployment completes.
6. Select **Update** when the PWA update banner appears.

Keeping the same site address allows existing browser storage to remain
associated with the viewer.

## Automated validation

The repository includes a dependency-free Node.js validation script and a
GitHub Actions workflow.

The workflow checks:

- JavaScript syntax
- Required release files
- PWA manifest settings
- Demo chart dimensions
- Project storage, details, row notes, and individual backup round-tripping
- Exact-stitch, scroll-mode, and screen-awake preference persistence
- Selective project restore behavior
- Viewer initialization with a mocked browser and canvas environment
- Rejection of unknown stitch codes
- Rejection of unsafe palette color values

Run locally with:

```bash
node tests/validate-release.js
node tests/validate-viewer-runtime.js
```

## Repository contents

| File or folder | Purpose |
|---|---|
| `index.html` | Project library, importing, preview, and backup screen |
| `viewer.html` | Interactive chart viewer |
| `library.js` | Project library and import interface |
| `stitch-fiddle-pdf.js` | Local Stitch Fiddle PDF parser |
| `project-store.js` | Project, notes, compact progress, recovery, individual export, and backup storage |
| `viewer.js` | Rendering, ruler and segment strip, navigation, notes, wake lock, tap lock, undo, and exact-stitch tracking |
| `library.css` | Project-library and import styles |
| `viewer.css` | Viewer and mobile Crochet Mode styles |
| `manifest.webmanifest` | Installable app metadata |
| `service-worker.js` | Offline application caching |
| `pwa.js` | Service-worker registration and update prompt |
| `icons/` | Home Screen and PWA icons |
| `vendor/` | Bundled PDF decompression dependency |
| `demo-geometric-bloom.json` | Original public demo chart |
| `PDF_IMPORT.md` | PDF importer details |
| `JSON_FORMAT.md` | Compatible JSON schema |
| `PRIVACY.md` | Public privacy explanation |
| `THIRD_PARTY_NOTICES.md` | Third-party license notices |
| `RELEASE_NOTES.md` | Release history |
| `tests/` | Dependency-free release and viewer-runtime validation tests |
| `.github/workflows/` | Automated GitHub validation |
| `LICENSE` | Project license |

## Copyright and pattern responsibility

The viewer is intended to help users privately view and track charts they are
authorized to use.

Users remain responsible for following the copyright, licensing, and sharing
terms attached to imported patterns. Importing a pattern into private browser
storage does not grant permission to publish, sell, or redistribute the PDF,
the chart, or converted chart data.

## Independence disclaimer

This is an independent compatibility tool. It is not affiliated with,
endorsed by, sponsored by, or maintained by Stitch Fiddle.

“Stitch Fiddle” is referenced only to identify the PDF export format supported
by the importer.

## License

The application code and original Geometric Bloom demo chart are licensed
under the [MIT License](LICENSE).

The bundled pako decompression library is MIT-licensed. Its notice is included
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
