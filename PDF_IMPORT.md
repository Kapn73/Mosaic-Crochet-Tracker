# Stitch Fiddle PDF importer

## Supported input

The importer is designed for the normal free PDF exported from a two-color Stitch Fiddle mosaic
crochet chart.

It reads the PDF's vector rectangles and embedded stitch-font symbols directly. It does not use
OCR and does not estimate the design from a screenshot.

## Conversion rules

- No symbol: `s` — single crochet, shown as a blank cell
- Default double-crochet glyph: `d` — shown as X
- Default border glyph: `b` — shown as BS
- Foundation-chain glyph: `c`
- Color A row marker: working color A
- Color B row marker: working color B

The visible PDF row is reversed when stored because the viewer displays stitch 1 on the right.
This prevents the imported design from appearing horizontally mirrored.

## Validation

The import is rejected when:

- A complete rectangular chart grid cannot be found
- Color A and Color B markers cannot be identified
- A row is missing cells
- An unknown stitch symbol appears
- The foundation row is not a complete chain row
- The PDF uses an unsupported stream compression method
- The chart exceeds the current safety limit of 200,000 grid cells

## Privacy

The PDF is read in the browser from the selected local file. The source PDF is not written to the
repository, and the converted project is stored in the user's browser and optional backup file.
