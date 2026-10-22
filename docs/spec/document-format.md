# Annotation document format (`document.json`)

Version: **1** · Status: stable for Phase 1

Each library item may have a `document.json` next to its `original.png`. It describes all
annotations as vector objects, so they stay editable and the original stays untouched.
The TypeScript source of truth is
[`apps/desktop/src/editor/document.ts`](../../apps/desktop/src/editor/document.ts).

## Rules

- All coordinates and sizes are in **pixels of the original image**, origin top-left.
  Shapes may lie outside the image (negative or too large coordinates).
- The **output area** is the bounding box of what is left of the image (after `erased`)
  plus all shapes. Everything in it that is not covered is transparent. Drawing outside
  the image therefore enlarges the output; deleting an edge strip shrinks it.
- Colours are CSS hex strings (`#rrggbb`).
- `objects` are painted in order; the last one is on top.
- Readers must reject documents with an unknown `schemaVersion` (the editor then starts
  a fresh document and leaves the file alone until the user edits).
- Writers must keep unknown top-level fields out; new fields require a new schema version.

## Top level

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `1` | Format version |
| `canvas` | `{ width, height }` | Size of `original.png` |
| `erased` | `Rect[]` | Deleted areas of the image (transparent); shapes are not affected |
| `objects` | `Shape[]` | Annotations |

`Rect` = `{ x, y, width, height }`.

## Shapes

Every shape has a unique `id` (string, UUID) and a `type`.

| `type` | Fields | Rendering |
|---|---|---|
| `arrow` | `points: [x1, y1, x2, y2]`, `stroke`, `strokeWidth` | Line from tail to head with a filled arrowhead of size `strokeWidth × 3 + 6` |
| `rect` | `Rect`, `stroke`, `strokeWidth` | Outline, corner radius 2 |
| `text` | `x`, `y` (top-left), `text`, `fontSize`, `fill`, optional `width` | Bold sans-serif, line height 1.2, multi-line via `\n`; with `width` the text wraps at word boundaries |
| `highlight` | `Rect`, `fill` | Filled rectangle, blend mode *multiply* |
| `blur` | `Rect`, `pixelSize` | The original pixels under the rectangle, pixelated in blocks of `pixelSize` |

## Example

```json
{
  "schemaVersion": 1,
  "canvas": { "width": 1920, "height": 1080 },
  "erased": [{ "x": 0, "y": 800, "width": 1920, "height": 280 }],
  "objects": [
    { "id": "5c0e…", "type": "highlight", "x": 90, "y": 60, "width": 300, "height": 40, "fill": "#f2c94c" },
    { "id": "8a1f…", "type": "arrow", "points": [500, 400, 320, 260], "stroke": "#e5322d", "strokeWidth": 5 },
    { "id": "d2b7…", "type": "text", "x": 510, "y": 390, "width": 240, "text": "Click here to sign in", "fontSize": 26, "fill": "#e5322d" },
    { "id": "3e9d…", "type": "arrow", "points": [-120, -60, 20, 20], "stroke": "#e5322d", "strokeWidth": 5 },
    { "id": "0f3c…", "type": "rect", "x": 80, "y": 50, "width": 320, "height": 60, "stroke": "#e5322d", "strokeWidth": 5 },
    { "id": "77aa…", "type": "blur", "x": 900, "y": 20, "width": 200, "height": 40, "pixelSize": 10 }
  ]
}
```
