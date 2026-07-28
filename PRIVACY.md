# Privacy

Mosaic Crochet Project Viewer is designed as a local-first static web app.

## Data that stays on the device

The app stores the following in the visitor's browser:

- Imported chart data
- Project names
- Progress
- Current row, segment, and stitch
- Display preferences
- Archive status
- Backup connection information supported by the browser

Selected Stitch Fiddle PDFs are parsed in browser memory. The original PDF is
not uploaded by the app and is not stored in the public GitHub repository.

## No application accounts or remote database

The project includes no:

- User account system
- Application server
- Remote project database
- Pattern-upload endpoint
- Advertising SDK
- Analytics SDK

GitHub Pages serves the public application files only.

## Backups

A backup leaves the browser only when the visitor deliberately:

- Downloads a backup file
- Chooses a file for automatic desktop backup
- Saves or transfers that file using a cloud provider or another service

Those storage providers have their own privacy terms.

## Browser storage limitations

Browser data can be removed by clearing website data, deleting the browser,
changing the site address, or using a different device or browser profile.

Regular backups are recommended.

## Service worker

The service worker caches public application files for offline use. It does
not cache imported pattern PDFs, personal backup files, or browser database
contents.
