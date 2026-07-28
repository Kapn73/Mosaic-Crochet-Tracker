# Compatible chart JSON format

The viewer accepts a JSON object representing one mosaic crochet chart.

## Safety limits

- Maximum chart size: 200,000 cells
- Palette entries: 1 through 36
- Palette keys: one letter or number
- Palette colors: six-digit hexadecimal values
- Stitch codes: `s`, `d`, `b`, or `c`
- Working colors: `A` or `B`

Unknown values are rejected instead of being guessed.

## Required top-level fields

```json
{
  "chartId": "unique-chart-id",
  "title": "Project chart title",
  "dimensions": {
    "rows": 48,
    "stitchesPerRow": 48
  },
  "palette": {},
  "foundation": {},
  "rows": []
}
```

## Palette

Each character used in a row's `colors` string must exist as a palette key.

```json
"palette": {
  "0": {
    "id": 0,
    "name": "Color A",
    "hex": "#17324D",
    "rgb": [23, 50, 77]
  },
  "1": {
    "id": 1,
    "name": "Color B",
    "hex": "#E8B84A",
    "rgb": [232, 184, 74]
  }
}
```

The viewer recalculates RGB values from the validated hex color during import.

## Stitch codes

| Code | Meaning | Display |
|---|---|---|
| `s` | Single crochet | Blank cell |
| `d` | Double crochet | X |
| `b` | Border stitch | BS |
| `c` | Chain | Oval chain symbol |

Only visibly X-marked chart cells should be coded as `d`. Ordinary blank chart
cells should be coded as `s`, regardless of color.

## Foundation row

The `colors` and `stitches` strings must each contain exactly
`dimensions.stitchesPerRow` characters.

```json
"foundation": {
  "row": 0,
  "workingColor": "A",
  "colors": "000000",
  "stitches": "cccccc"
}
```

When the entire `foundation` field is omitted, the viewer creates a
foundation chain using the first palette color. A malformed foundation object
is rejected.

## Chart rows

There must be exactly `dimensions.rows` row objects, numbered from 1 through
the final row with no missing or duplicate numbers.

Each row needs:

- `number`
- `workingColor`
- `colors`
- `stitches`

Both strings must contain exactly `dimensions.stitchesPerRow` characters.

```json
{
  "number": 1,
  "workingColor": "A",
  "colors": "00111000",
  "stitches": "bssdddss"
}
```

## Minimal complete example

```json
{
  "schemaVersion": 2,
  "chartId": "small-demo",
  "title": "Small Demo",
  "dimensions": {
    "rows": 2,
    "stitchesPerRow": 6,
    "foundationRow": 0
  },
  "palette": {
    "0": {
      "id": 0,
      "name": "Color A",
      "hex": "#17324D",
      "rgb": [23, 50, 77]
    },
    "1": {
      "id": 1,
      "name": "Color B",
      "hex": "#E8B84A",
      "rgb": [232, 184, 74]
    }
  },
  "foundation": {
    "row": 0,
    "workingColor": "A",
    "colors": "000000",
    "stitches": "cccccc"
  },
  "rows": [
    {
      "number": 1,
      "workingColor": "A",
      "colors": "001100",
      "stitches": "bsddsb"
    },
    {
      "number": 2,
      "workingColor": "B",
      "colors": "011110",
      "stitches": "bddddb"
    }
  ]
}
```

The `source`, `orientation`, `design`, `stitchCodes`, and `binaryRows` fields
are optional metadata. Imported data is normalized into the current schema.
