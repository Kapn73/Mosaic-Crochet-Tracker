# Mosaic Crochet Project Viewer

A private, browser-based project library and progress tracker for overlay mosaic crochet.

Import a standard two-color Stitch Fiddle PDF directly, or import a compatible chart JSON. The app converts supported PDFs on the device, displays the chart in manageable stitch segments, and remembers progress separately for every project.

> **Privacy first:** imported PDFs, converted charts, project names, and progress are not uploaded to this repository or shared with other visitors. They remain in the visitor's browser unless the visitor intentionally creates a backup file.

## What it does

- Imports default two-color Stitch Fiddle mosaic crochet PDFs
- Imports compatible chart JSON files
- Converts supported PDFs locally without OCR or a server
- Corrects left/right orientation for the viewer
- Supports multiple named projects
- Tracks completed stitches, rows, segments, and current position
- Allows any segment size from 1 stitch through the full row
- Shows blank cells as single crochet and X cells as double crochet
- Provides Retina-sharp canvas rendering and adjustable zoom
- Saves each project's display preferences and progress
- Exports and restores complete library backups
- Can write automatic backups to a selected file when the browser supports it
- Includes an original 48 × 48 Geometric Bloom demo chart

## Quick start

### Use the hosted version

After the repository has been published with GitHub Pages, open the Pages address in a browser.

1. Select **New Project**.
2. Choose a supported `.pdf` or compatible `.json` file.
3. Review the detected chart dimensions.
4. Enter a project name.
5. Select **Create Project**.
6. Open the project and begin tracking progress.

### Run locally

Keep every file and folder together, then open `index.html` in a browser.

For the most consistent local-file and automatic-backup behavior, Chrome or another Chromium-based desktop browser is recommended. Manual **Download Backup** and **Restore Backup** remain available when automatic file writing is unavailable.

## Supported PDF format

The PDF importer is designed for the normal free PDF export produced by a default **two-color Stitch Fiddle overlay mosaic crochet chart**.

A supported PDF normally contains:

- A Stitch Fiddle legend page
- A vector chart page
- Color A and Color B row markers
- Blank single-crochet cells
- X-marked double-crochet cells
- Border-stitch cells
- A complete foundation-chain row

The importer reads the PDF's vector rectangles and embedded stitch-font symbols directly. It does not use OCR and does not estimate the chart from a screenshot.

### PDF conversion rules

| PDF cell or symbol | Viewer stitch code | Viewer display |
|---|---:|---|
| Blank chart cell | `s` | Blank single-crochet cell |
| Double-crochet symbol | `d` | X |
| Border-stitch symbol | `b` | BS |
| Foundation-chain symbol | `c` | Chain symbol |

The PDF's visible row is reversed while being stored because the viewer places stitch 1 on the right. This prevents imported patterns from appearing horizontally mirrored.

### Currently unsupported

The importer rejects rather than guesses when it encounters:

- Scanned PDFs
- Screenshots saved as PDFs
- PDFs exported by unrelated chart programs
- More than two working colors
- Missing or incomplete chart grids
- Unknown stitch symbols
- Missing foundation chains
- Unsupported PDF stream compression
- Charts above the current 200,000-cell safety limit

More technical details are available in [PDF_IMPORT.md](PDF_IMPORT.md).

## Compatible JSON import

The JSON importer remains available for original designs, manually converted charts, and other supported workflows.

See [JSON_FORMAT.md](JSON_FORMAT.md) for the required schema and stitch codes.

## Optional converted JSON download

After a PDF is successfully read, the import window offers **Download Converted JSON**. This is optional. The project can be created and used without downloading the converted JSON separately.

## Project storage and privacy

The app is a static site. It contains no account system, server database, analytics, or upload endpoint.

The public GitHub repository contains only:

- The app's HTML, CSS, and JavaScript
- The bundled PDF decompression library
- Documentation
- The original demo chart

Each visitor's imported charts and progress are stored separately in that visitor's browser using IndexedDB, with localStorage as a fallback.

Other visitors cannot see:

- Imported pattern PDFs
- Converted charts
- Project names
- Completed stitches
- Current rows or segments
- Backup files

Do not commit personal pattern files or library backups to the public repository.

## Backups

Browser storage is convenient, but it can be lost when browser data is cleared or an app/browser is removed.

### Manual backup

Use **Download Backup** to create one JSON file containing the complete project library, including:

- Imported chart data
- Project names
- Completed stitches
- Current row and segment
- Segment sizes
- Zoom and display settings

Use **Restore Backup** to replace the current browser library with a saved backup.

### Automatic backup

On supported desktop browsers, select **Enable Auto-Backup** and choose a normal JSON file. That file can be located in an iCloud Drive or Google Drive folder that is available through the operating system's file picker.

When automatic file access is unavailable, continue using **Download Backup** and **Restore Backup**.

## Using it on iPhone

1. Publish the repository with GitHub Pages.
2. Open the Pages address in Safari on the iPhone.
3. Use **New Project** to select a PDF or JSON from the Files app.
4. In Safari, use **Share → Add to Home Screen** for app-like access.

The iPhone and desktop browsers keep separate working libraries. To move progress between devices:

1. Download a fresh library backup on the device most recently used.
2. Save it in iCloud Drive or another shared location.
3. Restore it on the other device before continuing.

Do not work independently on both devices and then restore an older backup, because restoring replaces the current library rather than merging two versions.

## Publish with GitHub Pages

This project is already structured as a static GitHub Pages site. No build command is required.

1. Create or open a GitHub repository.
2. Upload **all files and folders** from this package to the repository root.
3. Confirm that `index.html`, `stitch-fiddle-pdf.js`, and the `vendor` folder are present at the root.
4. Commit the files to `main`.
5. Open **Settings → Pages**.
6. Under **Build and deployment**, choose **Deploy from a branch**.
7. Select the `main` branch and `/ (root)` folder.
8. Save the Pages configuration.

The included `.nojekyll` file tells GitHub Pages to serve this as a plain static site.

## Updating an existing installation

1. Open the current site and create a full-library backup.
2. Replace the repository files with the contents of the new release.
3. Keep the same repository and Pages address.
4. Commit the update.
5. Reload the site after GitHub Pages finishes publishing.

The storage database name is intentionally preserved, so projects already saved at the same site address should remain available. A backup is still strongly recommended before updating.

## Repository structure

| File or folder | Purpose |
|---|---|
| `index.html` | Project library and import screen |
| `viewer.html` | Interactive chart viewer |
| `library.js` | Project-library and import interface |
| `stitch-fiddle-pdf.js` | Local Stitch Fiddle PDF parser |
| `project-store.js` | Project storage, backup, and restore |
| `viewer.js` | Chart rendering and progress tracking |
| `library.css` | Project-library styling |
| `viewer.css` | Chart-viewer styling |
| `vendor/` | Bundled PDF stream decompression dependency |
| `demo-geometric-bloom.json` | Original public demo chart |
| `PDF_IMPORT.md` | PDF importer details and validation rules |
| `JSON_FORMAT.md` | Compatible JSON schema documentation |
| `THIRD_PARTY_NOTICES.md` | Third-party license notices |
| `LICENSE` | Project license |

## Troubleshooting

### The PDF is rejected

Confirm that it is the normal two-color Stitch Fiddle mosaic crochet PDF export rather than a scan, screenshot, or print-to-PDF copy.

### The pattern looks mirrored

Current imports reverse each row for the viewer automatically. Delete the incorrectly imported project and import the original PDF again using the current release.

### Projects disappeared after changing the website address

Browser storage is tied to the exact site address. Restore a full-library backup at the new address.

### Automatic backup is unavailable

Use **Download Backup** and save the file somewhere safe. Automatic selected-file writing depends on browser support and file permission.

### GitHub Pages shows an old version

Confirm the latest files were committed to the configured Pages branch and folder, then reload after publication completes. A hard refresh may be necessary when cached JavaScript files are still in use.

## Disclaimer

This project is an independent tool and is not affiliated with, endorsed by, or sponsored by Stitch Fiddle. “Stitch Fiddle” is referenced only to describe compatibility with its default PDF export format.

Users are responsible for respecting the copyright and license terms of any patterns they import. Importing a pattern into private browser storage does not grant permission to redistribute that pattern or its converted data.

## License

The application code and original Geometric Bloom demo chart are licensed under the [MIT License](LICENSE).

The bundled pako decompression library is also MIT-licensed. Its notice is included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
