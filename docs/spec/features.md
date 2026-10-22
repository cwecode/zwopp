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
| Search, tags, favorites | SQLite index | ⬜ (1) |
| Thumbnails | Generated small previews for speed | ⬜ (1) |
| Drag out | Drag an item into other apps | ⬜ (2) |
| OCR | Search text inside screenshots | ⬜ (v2) |

## Editor

All annotations are stored as vector objects next to the original (non-destructive).

| Tool | Description | Status |
|---|---|---|
| Select / move / resize | | ⬜ (1) |
| Arrow, line | Color, width, arrowhead styles | ⬜ (1) |
| Rectangle, ellipse | Outline / fill | ⬜ (1) |
| Text | Font size, color, background | ⬜ (1) |
| Highlighter | Semi-transparent marker | ⬜ (1) |
| Blur / pixelate | Hide sensitive data | ⬜ (1) |
| Crop | | ⬜ (1) |
| Undo / redo | | ⬜ (1) |
| Callout / speech bubble | Text box with a pointer tail | ⬜ (2) |
| Step numbers | Auto-incrementing numbered badges | ⬜ (2) |
| Emoji / stickers | | ⬜ (2) |
| Magnify | Enlarged inset of a region | ⬜ (2) |
| Quick styles | Saved tool presets | ⬜ (2) |

## Export & automation

| Feature | Status |
|---|---|
| PNG / JPG / WebP export, copy rendered image | ⬜ (1) |
| CLI (`screenbook capture …`) | ⬜ (v2) |
| Local HTTP API (loopback, token, OpenAPI) | ⬜ (v2) |
| MCP server | ⬜ (v2) |
