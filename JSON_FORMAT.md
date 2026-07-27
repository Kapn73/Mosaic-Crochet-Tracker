# Compatible chart JSON format

A compatible chart needs:

- `chartId`
- `title`
- `dimensions.rows`
- `dimensions.stitchesPerRow`
- `palette`
- `foundation`
- exactly one object in `rows` for every row

Each row needs `number`, `workingColor`, `colors`, and `stitches`.

The `colors` and `stitches` strings must each be exactly as long as
`dimensions.stitchesPerRow`.

## Stitch codes

| Code | Meaning | Display |
|---|---|---|
| `s` | Single crochet | Blank |
| `d` | Double crochet | X |
| `b` | Border stitch | BS |
| `c` | Chain | Oval |

## Minimal example

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
