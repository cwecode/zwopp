# Annotation document format (`document.json`)

Version: **3** · Status: stable (version 1 and 2 documents are read as they are, see below)

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
| `schemaVersion` | `3` | Format version |
| `canvas` | `{ width, height }` | Size of `original.png` |
| `erased` | `Rect[]` | Deleted areas of the image (transparent); shapes are not affected |
| `layers` | `Layer[]` | Layers above the screenshot, bottom to top; at least one |
| `objects` | `Shape[]` | Annotations |
| `groups` | `Group[]` | Blocks (optional, default `[]`) |

`Group` = `{ id, name, frame }` with `frame` = `{ stroke, strokeWidth, padding }` or `null`.
A shape with `group` set is a member of that block; members are selected, moved and scaled
together. A block has at least two members (otherwise it is dissolved on load). A frame is
drawn as a rounded rectangle around the members' extent plus `padding`, above the layer's
shapes, and counts for the output area.

`Layer` = `{ id, name, visible, locked }`. The first layer is the **base layer** ("Original"):
it holds the screenshot, cannot be deleted and always stays at the bottom; hiding it hides
the screenshot. Paint order: the screenshot, then layer by layer from bottom to top; within
a layer, shapes in `objects` order (later is on top). Shapes of hidden layers are not
rendered and do not count for the output area.

**Migration from version 1:** all shapes go into the base layer "Original". A base layer
named "Ebene 1" (early version 2 documents) is renamed to "Original".

**Version 3** only added optional fields (`startHead`, `endHead`, `fill`) and the `ellipse`
type. Their defaults reproduce version 2, so version 2 documents need no migration; they are
saved as version 3 on the next change.

`Rect` = `{ x, y, width, height }`.

## Shapes

Every shape has a unique `id` (string, UUID), a `type`, the `layer` id it belongs to and
optionally the `group` id of its block.

| `type` | Fields | Rendering |
|---|---|---|
| `arrow` | `points: [x1, y1, x2, y2]`, `stroke`, `strokeWidth`, optional `startHead`, `endHead` | Straight line from start to end, round caps. Each end has a head: `"none"`, `"filled"` (triangle in the stroke colour) or `"open"` (two strokes meeting at the end point); length and width `strokeWidth × 3 + 6`. Defaults: `startHead` `"none"`, `endHead` `"filled"`. Without heads it is a plain line |
| `rect` | `Rect`, `stroke`, `strokeWidth`, optional `fill` | Outline, corner radius 2; with `fill` also filled |
| `ellipse` | `Rect`, `stroke`, `strokeWidth`, optional `fill` | Ellipse inscribed in the rectangle; with `fill` also filled |
| `text` | `x`, `y` (top-left), `text`, `fontSize`, `fill`, optional `width` | Bold sans-serif, line height 1.2, multi-line via `\n`; with `width` the text wraps at word boundaries |
| `highlight` | `Rect`, `fill` | Filled rectangle, blend mode *multiply* |
| `blur` | `Rect`, `pixelSize` | The original pixels under the rectangle, pixelated in blocks of `pixelSize` |
| `image` | `Rect`, `asset` | The PNG `assets/<asset>` of the same item, scaled to the rectangle. Used for content pasted from another screenshot |

When a whole edit is copied, its screenshot becomes an `image` shape (with deleted areas
transparent and `blur` areas already pixelated, so hidden pixels are never copied) and its
other shapes are copied as they are.

## Example

```json
{
  "schemaVersion": 3,
  "canvas": { "width": 1920, "height": 1080 },
  "erased": [{ "x": 0, "y": 800, "width": 1920, "height": 280 }],
  "layers": [
    { "id": "L1", "name": "Original", "visible": true, "locked": false },
    { "id": "L2", "name": "Privat", "visible": true, "locked": true }
  ],
  "objects": [
    { "id": "5c0e…", "layer": "L1", "type": "highlight", "x": 90, "y": 60, "width": 300, "height": 40, "fill": "#f2c94c" },
    { "id": "8a1f…", "layer": "L1", "type": "arrow", "points": [500, 400, 320, 260], "stroke": "#e5322d", "strokeWidth": 5 },
    { "id": "d2b7…", "layer": "L1", "type": "text", "x": 510, "y": 390, "width": 240, "text": "Click here to sign in", "fontSize": 26, "fill": "#e5322d" },
    { "id": "3e9d…", "layer": "L1", "type": "arrow", "points": [-120, -60, 20, 20], "stroke": "#e5322d", "strokeWidth": 5 },
    { "id": "0f3c…", "layer": "L1", "type": "rect", "x": 80, "y": 50, "width": 320, "height": 60, "stroke": "#e5322d", "strokeWidth": 5 },
    { "id": "4b21…", "layer": "L1", "type": "arrow", "points": [40, 700, 600, 700], "stroke": "#1d1d1b", "strokeWidth": 3, "startHead": "open", "endHead": "open" },
    { "id": "9d0e…", "layer": "L2", "type": "ellipse", "x": 1200, "y": 300, "width": 160, "height": 90, "stroke": "#1d1d1b", "strokeWidth": 3, "fill": "#1d1d1b" },
    { "id": "77aa…", "layer": "L2", "type": "blur", "x": 900, "y": 20, "width": 200, "height": 40, "pixelSize": 10 }
  ]
}
```
