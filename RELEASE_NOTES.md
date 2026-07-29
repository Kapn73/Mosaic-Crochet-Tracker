# Release notes

## Crochet Usability release

### Working view

- Added three automatic chart-movement modes: center the segment, keep the
  segment visible, or leave the chart stationary.
- Added a large working-segment strip with exact stitch numbers, symbols,
  completion shading, and the active-stitch outline.
- Added a synchronized stitch-number ruler and work-direction guide above the
  full chart.

### Project information

- Added project fields for yarn, hook size, gauge, start date, and general
  notes.
- Added notes for individual rows with automatic local saving.
- Included all project and row notes in full and individual backups.

### Project transfer and restore

- Added individual-project export from the library and loaded viewer.
- Added selective restore checkboxes, Select All, and Clear Selection.
- Updated merge and replace restore modes to operate only on selected projects.

### Active crocheting

- Added an optional Screen Wake Lock control for supported browsers.
- Added accidental-tap protection that disables chart selection and editing
  controls while keeping scrolling, navigation, and mobile Complete & Next
  available.
- Added a lock control to the mobile Crochet Mode toolbar.

### Storage and compatibility

- Added project-detail and row-note normalization to the existing local-first
  storage model.
- Added backward-compatible migration from the previous auto-center checkbox
  to the new chart-movement modes.
- Increased the static asset and offline cache version so hosted sites receive
  the new release.

## Segment-centering correction

- Automatic scrolling now centers the complete active segment instead of the
  individual stitch.
- The exact current stitch remains visibly outlined inside the centered
  segment.
- The setting and navigation button now use segment-centered wording.
- Static asset and offline-cache versions were increased so hosted sites
  receive the corrected behavior.

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
- Kept exact-stitch outlining while centering the complete working segment.

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
