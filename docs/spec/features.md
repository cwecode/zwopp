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
| Search, tags, favorites | SQLite index, search in title and tags | ✅ (1) |
| Thumbnails | Generated small previews for speed | ✅ (1) |
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
| Line, ellipse, filled shapes, arrowhead styles | | ⬜ (2) |
| Text background, fonts | | ⬜ (2) |
| Callout / speech bubble | Text box with a pointer tail | ⬜ (2) |
| Step numbers | Auto-incrementing numbered badges | ⬜ (2) |
| Emoji / stickers | | ⬜ (2) |
| Magnify | Enlarged inset of a region | ⬜ (2) |
| Quick styles | Saved tool presets | ⬜ (2) |

## Export & automation

| Feature | Status |
|---|---|
| Copy annotated image to the clipboard | ✅ (1) |
| Export to file (PNG / JPG / WebP) | ⬜ (2) |
| CLI (`screenbook capture …`) | ⬜ (v2) |
| Local HTTP API (loopback, token, OpenAPI) | ⬜ (v2) |
| MCP server | ⬜ (v2) |
