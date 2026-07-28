# Stitch Fiddle PDF importer

The importer reads the normal free PDF export produced by a default two-color
Stitch Fiddle overlay mosaic crochet chart.

## Local processing

The selected PDF is read by JavaScript in the browser. It is not sent to a
server, GitHub repository, analytics service, or remote database.

## What is extracted

The importer locates the chart page with the largest compatible vector grid
and reads:

- Chart width
- Chart row count
- Vector cell colors
- Embedded stitch symbols
- Color A and Color B row markers
- Border stitches
- Foundation chain
- Row and stitch orientation

The result is converted to the viewer's internal JSON chart structure and
validated before project creation.

## Import preview

After extraction, the import window displays a locally rendered preview.

Available controls:

- **Flip Horizontally** reverses every row, the foundation row, and color data.
- **Swap Colors** swaps the displayed palette entries without changing stitch
  placement.
- **Copy Diagnostics** copies importer version, dimensions, stitch counts,
  palette, source metadata, and any error information.
- **Download Converted JSON** saves the locally generated chart data.

## Compatibility assumptions

The current parser is intended for the default two-color export layout:

- One legend page
- One vector chart page
- One color marker column on each side
- Two working colors
- Blank single-crochet cells
- Embedded double-crochet, border, and chain glyphs

It does not use OCR.

## Rejected inputs

The importer rejects:

- Non-PDF files
- Scanned or image-only pages
- Incomplete grids
- Unknown symbol patterns
- Unsupported compressed streams
- Charts above 200,000 cells
- Files where a reliable chart page cannot be identified

The importer reports an error code rather than silently guessing.

## Tested default exports

Release validation has been performed against default exports with these
dimensions:

- 267 rows × 200 stitches
- 251 rows × 150 stitches

The private source patterns used during development are not included in the
public repository.

## Orientation

The viewer displays stitch 1 on the right. Imported rows are stored in that
orientation. The preview should still be checked before project creation
because PDF layouts may change in future exports.

## Future compatibility

A future Stitch Fiddle PDF change could require a parser update. Include the
copied diagnostics and the non-confidential error details when filing an issue.
Do not publicly attach a copyrighted pattern PDF unless redistribution is
permitted.
