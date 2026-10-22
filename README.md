# Screenbook

A lean, open-source screenshot tool for **Windows, macOS and Linux**: select a region,
the screenshot lands in a **library**, and an **editor** lets you add arrows, callouts,
highlights, step numbers, emojis and more.

> **Status: Phase 0 (spike).** Region capture, library and tray work; the annotation
> editor arrives in Phase 1. See the [project plan](docs/PLAN.md) (German).

## Features (current)

- Global hotkey **Ctrl+Shift+X** (macOS: **⌘⇧X**) or tray menu → region capture
- "Freeze first, select later": all monitors are frozen, then you drag a region
  (click = whole monitor, Esc / right-click = cancel)
- Every capture is saved to the library and copied to the clipboard
- Library window with thumbnails, preview and delete
- Runs in the system tray; closing the window keeps it running

## Install

Pre-built downloads (unsigned) will be published on the
[Releases](../../releases) page starting with the first tagged version.

- **Windows:** SmartScreen shows "Windows protected your PC" → *More info* → *Run anyway*.
- **macOS:** right-click the app → *Open*, or *System Settings → Privacy & Security → Open Anyway*.
- **Linux:** AppImage or `.deb`, no extra steps.

## Run from source

### Prerequisites

| | |
|---|---|
| All | [Git](https://git-scm.com), [Rust](https://rustup.rs) (stable, ≥ 1.90), [Node.js](https://nodejs.org) LTS |
| Windows | Visual Studio 2022 or Build Tools with **"Desktop development with C++"**; WebView2 (preinstalled on Windows 11) |
| macOS | Xcode Command Line Tools: `xcode-select --install` |
| Linux (Debian/Ubuntu) | see below |

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  build-essential curl wget file libssl-dev pkg-config libclang-dev \
  libxcb1-dev libxrandr-dev libdbus-1-dev libpipewire-0.3-dev libwayland-dev libegl-dev libgbm-dev
```

Other distributions: see the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

### Start

```bash
git clone https://github.com/screenbook/screenbook.git
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
npm run typecheck      # TypeScript
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT) at your option.

Screenbook is an independent project and is not affiliated with any commercial screenshot software.
