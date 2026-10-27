# Screenbook

A lean, open-source screenshot tool for **Windows, macOS and Linux**: select a region,
the screenshot lands in a **library**, and an **editor** lets you add arrows, callouts,
highlights, step numbers, emojis and more.

> **Status: Phase 1.5.** Capture, library and the basic editor work; the library stays fast
> with 100 000 screenshots.
> See the [project plan](docs/PLAN.md) (German) and the [feature list](docs/spec/features.md).

## Features (current)

- Global hotkey **Ctrl+Shift+X** (macOS: **⌘⇧X**) or tray menu → region capture.
  If another app owns that key, Screenbook falls back to Ctrl+Alt+X, then Ctrl+Shift+2;
  the active one is shown in the library toolbar
- "Freeze first, select later": all monitors are frozen, then you drag a region
  (click = whole monitor, Esc / right-click = cancel)
- Every capture is saved to the library, copied to the clipboard and opened in the editor
- **Library:** thumbnails, search (title, tags), favorites, tags, copy, delete
- **Editor:** arrow, rectangle, text box, highlighter, pixelate; colors and sizes;
  move/resize; undo/redo; autosave; copy the annotated image. Draw outside the screenshot
  and the canvas grows (transparent background); mark an area and press Del to delete it.
  A layers panel lists every element and lets you add, hide, lock and reorder layers.
  A filmstrip shows the library; copy a whole edit or a selection and paste it into another
  screenshot as a movable block.
  Annotations stay editable ([format](docs/spec/document-format.md)), the original is never changed
- Runs in the system tray; closing the window keeps it running

### Editor shortcuts

| Key | Action |
|---|---|
| V / A / R / T / H / B | Select / Arrow / Rectangle / Text / Highlighter / Pixelate |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Drag on empty area (V) | Mark an area |
| Del | Delete marked area, or the selected shapes |
| Shift+click, Ctrl+A | Add to selection, select all |
| Ctrl+↑ / Ctrl+↓ | Bring forward / send backward (with Shift: to front / back) |
| Ctrl+C | Copy selection – or, with nothing selected, the whole edit (screenshot + annotations) |
| Ctrl+V | Paste as a block (also into another screenshot) |
| Ctrl+Shift+C | Copy the finished image to the system clipboard |
| Alt+← / Alt+→ | Previous / next screenshot from the filmstrip |
| Ctrl+wheel, Ctrl++ / Ctrl+− | Zoom (at the cursor) |
| Ctrl+0 / Ctrl+1 | Fit ("Einpassen", fills the window) / actual pixels (100 %) |
| Ctrl+G / Ctrl+Shift+G | Make a block from the selection / dissolve it |
| Double-click a block | Open it to edit single elements |
| Wheel, Space+drag, middle mouse | Pan |
| Double-click text | Edit text (Esc or Ctrl+Enter to finish) |

## Install

Pre-built downloads (unsigned) will be published on the
[Releases](../../releases) page starting with the first tagged version.

- **Windows:** SmartScreen shows "Windows protected your PC" → *More info* → *Run anyway*.
- **macOS:** right-click the app → *Open*, or *System Settings → Privacy & Security → Open Anyway*.
- **Linux:** AppImage or `.deb`, no extra steps. Needs Ubuntu 24.04, Debian 13 or a
  similarly recent distribution (PipeWire ≥ 1.0).

## Run from source

### Prerequisites

| | |
|---|---|
| All | [Git](https://git-scm.com), [Rust](https://rustup.rs) (stable, ≥ 1.90), [Node.js](https://nodejs.org) LTS |
| Windows | Visual Studio 2022 or Build Tools with **"Desktop development with C++"**; WebView2 (preinstalled on Windows 11) |
| macOS | Xcode Command Line Tools: `xcode-select --install` |
| Linux (Debian/Ubuntu) | Ubuntu 24.04 / Debian 13 or newer, see below |

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  build-essential curl wget file libssl-dev pkg-config libclang-dev \
  libxcb1-dev libxrandr-dev libdbus-1-dev libpipewire-0.3-dev libwayland-dev libegl-dev libgbm-dev
```

Other distributions: see the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

### Start

```bash
git clone https://github.com/cwecode/screenbook.git
cd screenbook
npm install
npm run dev
```

`npm run build:app` builds an optimized, unsigned binary at
`target/release/screenbook` (`.exe` on Windows) that you can start directly.

### Permissions

- **macOS:** allow *Screen Recording* for your terminal (dev) or for Screenbook (build) in
  *System Settings → Privacy & Security*.
- **Linux/Wayland:** the desktop portal asks for permission on the first capture.

## Project layout

```
apps/desktop/          Tauri app: React UI (src/) and Rust shell (src-tauri/)
crates/core/           screenbook-core: capture, library, export (no UI)
docs/                  plan, architecture decisions (adr/), feature spec (spec/)
```

All functionality lives in `screenbook-core`; the desktop app is a thin layer on top.
That keeps the planned CLI, HTTP API and MCP server (v2) on the same code path.

## Development

```bash
npm run dev            # app with hot reload
npm test               # Rust tests
npm test -w apps/desktop   # TypeScript unit tests (Vitest)
npm run typecheck      # TypeScript
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
```

### Performance

The library is built for 100 000+ screenshots (see [ADR 0004](docs/adr/0004-library-performance.md)).

```bash
# Benchmarks (default 20 000 items; set SCREENBOOK_BENCH_ITEMS for more)
cargo bench -p screenbook-core --bench library
# Fill a library folder with synthetic items, e.g. to try the app with 100 000
cargo run -p screenbook-core --release --example seed -- <library-dir> 100000
```

Start the app on such a library (your own library stays untouched) by setting
`SCREENBOOK_LIBRARY_DIR=<library-dir>` before `npm run dev`.

The budgets from [docs/PLAN.md](docs/PLAN.md) (Phase 1.5) are checked in CI with
100 000 items; run them locally with:

```bash
# Core: paging, search, adding a screenshot (release build)
cargo test -p screenbook-core --release --test budgets -- --ignored --nocapture
# UI: first thumbnails, scrolling, jumps, search, memory (once: npx playwright install chromium)
npm run test:budgets -w apps/desktop
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT) at your option.

Screenbook is an independent project and is not affiliated with any commercial screenshot software.
