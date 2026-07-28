# Release notes

## Stability & Mobile release

### Import safety

- Added strict JSON validation for dimensions, palette keys, hex colors,
  working colors, stitch codes, row numbering, and string lengths.
- Added JSON and PDF size limits.
- Replaced dynamic legend HTML injection with safe DOM text rendering.
- Added PDF import preview, horizontal flip, color swap, and diagnostics.

### Mobile

- Added exact-stitch tracking.
- Added iPhone-first Crochet Mode.
- Added a sticky mobile control dock.
- Restored normal touch panning and pinch behavior.
- Added active-stitch outlining and auto-centering.

### Progress and recovery

- Split chart and progress records in IndexedDB.
- Added compact bitset storage for completed stitches.
- Added an immediate emergency recovery journal.
- Added up to 20 in-session undo actions.
- Added current and next row color guidance.

### Backups

- Added backup inspection before restore.
- Added merge and replace restore modes.
- Added pre-restore recovery and Undo Last Restore.

### Library

- Added search, sorting, archiving, and duplication.

### Display

- Added editable yarn names and colors.
- Added PWA manifest, Home Screen icons, offline caching, and update prompts.

### Quality

- Added dependency-free release tests.
- Added a GitHub Actions validation workflow.
- Updated public documentation and privacy information.
