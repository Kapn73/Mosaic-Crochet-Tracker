# Mosaic Crochet Project Viewer

A privacy-focused browser app for importing mosaic crochet charts, breaking
large rows into manageable sections, and tracking progress one stitch at a
time.

The viewer accepts:

- Default two-color Stitch Fiddle overlay mosaic crochet PDF exports
- Compatible Mosaic Crochet Project Viewer JSON files

Supported PDFs are converted directly in the browser. No account, server
upload, paid conversion service, or separate JSON conversion step is required.

## Start using the viewer

Open the hosted viewer in a modern browser.

1. Select **New Project**.
2. Choose a supported PDF or JSON file.
3. Review the detected chart size and stitch totals.
4. Enter a project name.
5. Select **Create Project**.
6. Open the project and begin tracking progress.

A built-in **Geometric Bloom Demo** is included so the viewer can be explored
without importing a personal pattern.

## Main features

- Direct import of supported Stitch Fiddle PDF exports
- Import of compatible JSON chart files
- Multiple named crochet projects
- Automatic progress saving for each project
- Adjustable working sections from 1 stitch through the full row
- Current row, segment, and stitch-range tracking
- Blank cells displayed as single crochet
- X-marked cells displayed as double crochet
- Border-stitch and foundation-chain support
- Automatic correction of PDF left/right orientation
- Retina-sharp chart rendering
- Adjustable zoom and focus settings
- Complete library backup and restore
- Optional automatic backup to a selected desktop file
- iPhone and desktop browser support
- Light and dark mode support

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

The importer also reverses each stored row when necessary because the viewer
places stitch 1 on the right. This prevents supported PDF patterns from
appearing horizontally mirrored.

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

The required structure is documented in [JSON_FORMAT.md](JSON_FORMAT.md).

After a PDF is successfully read, **Download Converted JSON** is available as
an optional convenience. Downloading the converted JSON is not required to use
the project.

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
- Current rows or segments
- Backup files

The public repository contains only the application files, documentation,
third-party dependency notices, and the original demo chart.

## Progress storage

Projects and progress are stored in the browser using IndexedDB, with
localStorage available as a fallback.

Saved data includes:

- Imported chart data
- Project names
- Completed stitches
- Current row and segment
- Segment size
- Zoom level
- Grid, symbol, focus, and foundation-row settings

Browser storage belongs to a specific browser, device, browser profile, and
website address. Clearing browser data or removing the browser may erase the
working copy.

## Backups

### Download Backup

**Download Backup** creates one JSON file containing the complete project
library and all saved progress.

Store the file somewhere safe, such as:

- iCloud Drive
- Google Drive
- OneDrive
- Dropbox
- An external drive
- A normal local folder

### Restore Backup

**Restore Backup** replaces the current browser library with the projects and
progress contained in a saved backup.

Restoring does not merge two independent libraries. The selected backup
becomes the current library.

### Automatic backup

Supported desktop Chromium browsers can use **Enable Auto-Backup** to select a
normal JSON file that the viewer updates after project changes.

The selected file may be located in a cloud-synced folder such as iCloud Drive
or Google Drive.

Automatic selected-file writing is not available in every browser. Manual
**Download Backup** and **Restore Backup** remain available as the universal
fallback.

## Using the viewer on iPhone

1. Open the hosted viewer in Safari.
2. Select **New Project**.
3. Choose a supported PDF or JSON file from the Files app.
4. Import the chart and begin tracking progress.
5. Use **Share → Add to Home Screen** for app-like access.

The Home Screen version still stores its projects locally on the iPhone.

Automatic selected-file backup may be unavailable in iPhone Safari. Use
**Download Backup** and save the backup in iCloud Drive or another accessible
location.

## Using the same projects on multiple devices

Browser libraries do not automatically synchronize between an iPhone and a
computer.

To continue on another device:

1. Download a fresh backup on the device used most recently.
2. Save it in a shared location such as iCloud Drive.
3. Open the viewer on the second device.
4. Restore that backup before continuing.

Avoid making separate progress on both devices without transferring the latest
backup. Restoring an older file can overwrite newer progress.

## Troubleshooting

### A PDF is rejected

Confirm that it is the original default two-color Stitch Fiddle overlay mosaic
crochet PDF export. Scans, screenshots, and print-to-PDF copies may no longer
contain the vector cells and embedded stitch symbols needed by the importer.

### A pattern looks mirrored

Current PDF imports correct the orientation automatically. Delete the
incorrectly imported project and import the original PDF again using the
current version of the viewer.

### Projects disappeared after the site address changed

Browser storage is tied to the exact website address. Restore a complete
library backup at the new address.

### Automatic backup is unavailable

Use **Download Backup** and save the file in a safe location. Automatic backup
depends on browser support and file permission.

### The website still shows an older version

Reload the page after the latest deployment finishes. A hard refresh may be
needed if the browser cached older JavaScript files.

## For repository owners and self-hosters

This project is a static site and requires no build command or server-side
code.

### GitHub Pages deployment

1. Upload all files and folders to the repository root.
2. Confirm that `index.html`, `stitch-fiddle-pdf.js`, and `vendor/` are present.
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

Keeping the same site address allows existing browser storage to remain
associated with the viewer. A backup is still strongly recommended.

## Repository contents

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
| `vendor/` | Bundled PDF decompression dependency |
| `demo-geometric-bloom.json` | Original public demo chart |
| `PDF_IMPORT.md` | PDF importer details |
| `JSON_FORMAT.md` | Compatible JSON schema |
| `THIRD_PARTY_NOTICES.md` | Third-party license notices |
| `RELEASE_NOTES.md` | Release history |
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

The bundled pako decompression library is also MIT-licensed. Its notice is
included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
