# Development

How to build Zwopp from source, how the code is laid out, and the checks and
performance budgets. To contribute, see also [CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

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

## Run from source

```bash
git clone https://github.com/cwecode/zwopp.git
cd zwopp
npm install
npm run dev
```

`npm run build:app` builds an optimized, unsigned binary at
`target/release/zwopp` (`.exe` on Windows) that you can start directly.

The development build runs as **Zwopp Dev** (identifier `digital.weier.zwopp.dev`), with
its own settings and library, next to an installed Zwopp; it never starts at login
(see [ADR 0008](adr/0008-running-in-the-background.md)). While an installed Zwopp runs,
it owns the capture hotkey; use **Screenshot** at the top of the dev window instead.

### Permissions

- **macOS:** allow *Screen Recording* for your terminal (dev) or for Zwopp (build) in
  *System Settings → Privacy & Security*.
- **Linux/Wayland:** the desktop portal asks for permission on the first capture.

## Project layout

```
apps/desktop/          Tauri app: React UI (src/) and Rust shell (src-tauri/)
crates/core/           zwopp-core: capture, library, export (no UI)
crates/cli/            zwopp-cli: command line (run by the app's executable)
skills/zwopp/          the Claude Code skill the settings install
docs/                  user guide, plan, architecture decisions (adr/), feature spec (spec/)
```

All functionality lives in `zwopp-core`; the desktop app and the command line are thin
layers on top and share the same code path.

## Checks

```bash
npm run dev            # app with hot reload
npm test               # Rust tests
npm test -w apps/desktop   # TypeScript unit tests (Vitest)
npm run typecheck      # TypeScript
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
cargo deny check       # vulnerabilities, licenses (deny.toml; cargo install cargo-deny)
```

CI runs the TypeScript checks once, the Rust checks on Windows, macOS and Linux, builds
the Windows installer and checks the dependencies; changes to docs alone skip it. The
performance budgets run when the library or the UI changes, and every night.

## Performance

The library is built for 100 000+ screenshots (see [ADR 0004](adr/0004-library-performance.md)).

```bash
# Benchmarks (default 20 000 items; set ZWOPP_BENCH_ITEMS for more)
cargo bench -p zwopp-core --bench library
# Fill a library folder with synthetic items, e.g. to try the app with 100 000
cargo run -p zwopp-core --release --example seed -- <library-dir> 100000
```

Start the app on such a library (your own library stays untouched) by setting
`ZWOPP_LIBRARY_DIR=<library-dir>` before `npm run dev`.

The budgets from [PLAN.md](PLAN.md) (Phase 1.5) are checked in CI with 100 000 items;
run them locally with:

```bash
# Core: paging, search, adding a screenshot (release build)
cargo test -p zwopp-core --release --test budgets -- --ignored --nocapture
# UI: first thumbnails, scrolling, jumps, search, memory (once: npx playwright install chromium)
npm run test:budgets -w apps/desktop
```
