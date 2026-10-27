# Feature specification

What Screenbook should do, written from a user's perspective.

Legend: ✅ done · 🚧 in progress · ⬜ planned · Phase in brackets.

## Capture

| Feature | Description | Status |
|---|---|---|
| Global hotkey | Starts a region capture from anywhere | ✅ (0) |
| Tray menu | Capture, open library, quit | ✅ (0) |
| Region selection | Drag a rectangle on a frozen image of the screen; size shown in pixels | ✅ (0) |
| Whole monitor | Single click during selection | ✅ (0) |
| Cancel | Esc or right-click | ✅ (0) |
| Multi-monitor | One overlay per monitor | ✅ (0) |
| Magnifier | Zoomed view of the pixels under the cursor while selecting | ⬜ (1) |
| Window capture | Hover highlights a window, click captures it | ⬜ (2) |
| Cross-monitor selection | Selection may span monitors | ⬜ (2) |
| Delay | Capture after 3/5/10 s | ⬜ (2) |
| Scrolling capture | Long pages stitched together | ⬜ (v2) |
| Screen recording / GIF | | ⬜ (v2) |

## Library

| Feature | Description | Status |
|---|---|---|
| Auto-save | Every capture is stored; originals are never overwritten | ✅ (0) |
| Clipboard | Capture is copied to the clipboard | ✅ (0) |
| Grid + preview | Thumbnails, newest first | ✅ (0) |
| Delete | | ✅ (0) |
| Search, tags, favorites | Full-text search in title and tags; every word must match, in any order, also as part of a word | ✅ (1) |
| Thumbnails | Small lossy WebP previews, generated in the background, served via `thumb://` | ✅ (1.5) |
| Large libraries | Virtualized grid and filmstrip, pages loaded on demand; tested with 100 000 items | ✅ (1.5) |
| Drag out | Drag an item into other apps | ⬜ (2) |
| OCR | Search text inside screenshots | ⬜ (v2) |

## Editor

All annotations are stored as vector objects next to the original (non-destructive),
see [document-format.md](document-format.md). Changes are saved automatically.

| Tool | Description | Status |
|---|---|---|
| Select / move / resize | Drag, transform handles, arrow end points; new shapes stay selected | ✅ (1) |
| Arrow | Color, size | ✅ (1) |
| Rectangle | Outline, color, size | ✅ (1) |
| Text box | Click (grows with text) or drag (fixed width, wraps); color, size | ✅ (1) |
| Highlighter | Rectangle marker, multiply blend | ✅ (1) |
| Blur / pixelate | Pixelates the original underneath | ✅ (1) |
| Draw outside the image | Canvas grows automatically, new area is transparent | ✅ (1) |
| Delete area | Mark an area with the select tool, press Del: image becomes transparent there, shapes inside are removed; edge strips shrink the image (replaces cropping) | ✅ (1) |
| Undo / redo | Ctrl+Z / Ctrl+Y | ✅ (1) |
| Layers panel | Every element is listed and selectable (also pixelate areas); the bottom layer "Original" holds the screenshot and always stays; further layers are only created by the user and can be renamed, hidden, locked, deleted and reordered; elements move between layers by drag and drop | ✅ (1) |
| Paste as block | Pasted content (several elements, e.g. a whole screenshot with annotations) becomes one block in the active layer, not a new layer | ✅ (1) |
| Blocks | Ctrl+G groups the selection into a block (e.g. a pasted screenshot with its annotations) that is picked, moved and scaled as one; double-click opens it to edit single elements; Ctrl+Shift+G dissolves | ✅ (1) |
| Block frame | Optional border around a block, color and width from the palette | ✅ (1) |
| Move to layer | "Verschieben nach" in the layers panel, select all elements of a layer | ✅ (1) |
| Stacking order | Bring forward/backward, to front/back (Ctrl+↑/↓, Ctrl+Shift+↑/↓) | ✅ (1) |
| Multi-select | Shift+click, marking an area, Ctrl+A; move and scale as a block | ✅ (1) |
| Copy / paste between screenshots | Ctrl+C copies the selection, or with nothing selected the whole edit (screenshot + annotations); Ctrl+V pastes it as a selected block, every element stays editable | ✅ (1) |
| Filmstrip | Library along the bottom of the editor, Alt+←/→ to switch | ✅ (1) |
| Zoom & pan | Ctrl+wheel / Ctrl+± zoom at the cursor, Ctrl+0 / "Einpassen" fills the window, Ctrl+1 actual pixels; wheel, middle mouse or Space+drag to pan; sharp at every zoom level (HiDPI-aware, high-quality downscaling) | ✅ (1) |
| Line, ellipse, filled shapes, arrowhead styles | | ⬜ (2) |
| Text background, fonts | | ⬜ (2) |
| Callout / speech bubble | Text box with a pointer tail | ⬜ (2) |
| Step numbers | Auto-incrementing numbered badges | ⬜ (2) |
| Emoji / stickers | | ⬜ (2) |
| Magnify | Enlarged inset of a region | ⬜ (2) |
| Quick styles | Saved tool presets | ⬜ (2) |

## General

| Feature | Description | Status |
|---|---|---|
| Language | German and English, picked from the system language; tooltips name keys as on the keyboard (Strg / Ctrl / ⌘) | ✅ (2) |
| Settings | Language, hotkey, library folder, defaults | ⬜ (2) |

## Export & automation

| Feature | Status |
|---|---|
| Copy annotated image to the clipboard | ✅ (1) |
| Export to file (PNG / JPG / WebP) | ⬜ (2) |
| CLI (`screenbook capture …`) | ⬜ (v2) |
| Local HTTP API (loopback, token, OpenAPI) | ⬜ (v2) |
| MCP server | ⬜ (v2) |
