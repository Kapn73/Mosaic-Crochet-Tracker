# Mosaic Crochet Project Viewer

A static, browser-based project library and progress tracker for mosaic crochet
charts. This public edition contains only an original demo pattern.

## Included demo

`demo-geometric-bloom.json` is a 48 × 48 original geometric sampler created
for this repository and released under the MIT license.

## Features

- Multiple saved projects
- Import compatible chart JSON
- Adjustable segment size from 1 stitch through the full row
- Per-project progress, position, zoom, and display settings
- Blank single-crochet cells and X double-crochet cells
- Retina-sharp chart rendering
- Full-library backup and restore
- Optional automatic backup to a selected file in iCloud Drive, Google Drive,
  or another folder

## Run locally

Open `index.html`. Chrome is recommended for automatic file backup.

## Publish with GitHub Pages

1. Create a repository.
2. Upload every file in this folder to the repository root.
3. Commit to `main`.
4. Open **Settings → Pages**.
5. Choose **Deploy from a branch**.
6. Select `main` and `/ (root)`.

The site address will look like:

`https://YOUR-USERNAME.github.io/mosaic-crochet-viewer/`

## Moving existing projects

Use **Download Backup** in the old copy, then **Restore Backup** in the hosted
copy. Browser storage is separate for each website address.

## New chart JSON files

See [JSON_FORMAT.md](JSON_FORMAT.md). A useful conversion request is:

> Convert this PDF into a JSON file compatible with my Mosaic Crochet Project
> Viewer. Blank cells are single crochet and only cells containing an X are
> double crochet.

## Privacy

Projects stay in each visitor's browser. Optional backups are written only to
the file that visitor selects.

## License

Code and the included original demo chart are licensed under the
[MIT License](LICENSE).
