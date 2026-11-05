# Changelog

All notable changes to Zwopp. The release workflow takes the notes of a version
from its section here, so each release starts with a `## <version>` heading.

## Unreleased

### General

- Updates on request: Zwopp looks for a new version now and then and offers it above the
  library and in the tray menu; one click installs it, nothing happens by itself.
  *Settings › General › Updates* shows the version and looks for updates on request.
  This version has to be installed by hand once; later ones come this way.

## 1.2.0

Panorama and GIF recordings join the screenshot, the editor gets a guided tool rail, and
Zwopp can start at login and wait in the tray at almost no cost. Existing libraries are
updated on the first start.

### Easier to start with

- The editor's tools are in a rail on the left, in eight families; each shows the tool
  used last, the triangle in its corner the others. Every tool keeps its key.
- The top bar shows colour and size; the rest of a tool's options is under **More**.
  Copy, paste, delete, blocks and stacking are in a right-click menu, export and dragging
  under **Share**. The layers panel starts closed.
- One-time tips explain useful things when they help; a dot points out tools not tried
  yet. Settings: show every tool on its own, show tips again.
- The library's delay moved into the menu of **New screenshot**; the settings are grouped
  in cards.

### Capture

- Capture modes, switched in a bar at the bottom of the screen or with ←/→: screenshot,
  panorama and GIF.
- Panorama: select an area and scroll down in it; Zwopp joins it into one tall image.
- GIF: record short click sequences with the mouse pointer and clicks; copy, drag or
  export the GIF to send it.

### General

- Light and dark appearance, or like the system: in the settings and with ☀️/🌙 in the
  library.
- A new, simpler app icon: two corners of a selection.
- Start at login (Settings › General): Zwopp waits in the tray, without a window.
- Lighter in the background: a closed window frees its memory after two minutes, the
  capture overlays load only their own code. Starting Zwopp again brings the running one
  to the front.

### Editor

- Pen (P) for freehand lines.
- Fill bucket (F): fills an area of similar colour.
- Magic wand (W): picks an area of similar colour to delete it, or keeps only it to cut
  out an object with a transparent background.

## 1.1.0

The library gets a sidebar for browsing, the editor stamps for step-by-step instructions.
Existing libraries are updated on the first start; screenshots taken before keep no
application.

### Library

- Sidebar with search, all screenshots, favorites, the last 7 days, years and months, and
  the applications screenshots were taken in, each with its count.
- A capture remembers the application it was taken in (not on Wayland), shown with the
  application's icon (on Windows; elsewhere its initial).

### Editor

- Mouse stamps (K): left, right, double and middle click, scroll and drag.
- Step numbers: Shift+click repeats the last number, a fixed number stamps the same one
  every time, and selected badges can be renumbered.

## 1.0.0

The first release, with unsigned downloads for Windows, macOS and Linux.

### Capture

- Global hotkey (default Ctrl+Shift+X / ⌘⇧X, falls back to Ctrl+Alt+X or Ctrl+Shift+2 if
  taken) and tray menu.
- All monitors are frozen first, then you select a region, also across monitors, with a
  magnifier at the cursor. Click for the window under the mouse, Shift+click for a whole
  monitor. Optional delay of 3, 5 or 10 seconds.
- Every capture lands in the library, is copied to the clipboard and opens in the editor
  (both can be turned off).

### Library

- Thumbnails, search over titles and tags, favorites, tags; stays fast with 100 000 items.
- Copy, export as PNG, JPG or WebP, drag into other apps, delete.

### Editor

- Arrow, line, rectangle, ellipse, text, callout, step numbers, emoji stickers, magnifier,
  highlighter, pixelate.
- Colours, sizes, arrowheads, fills, fonts and text backgrounds; quick styles to save and
  share styles; every tool remembers its last style.
- Layers, blocks, undo/redo, copy and paste between screenshots, filmstrip, zoom, canvas
  that grows when drawing outside the screenshot.
- Annotations stay editable; the original is never changed.

### General

- German and English.
- Settings for language, hotkey, library folder and what happens after a capture.
