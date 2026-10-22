# ADR 0001: Tauri 2 with a Rust core and a React UI

- Status: accepted
- Date: 2026-10-22

## Context

Screenbook is a tray app that is always running, needs low-level screen capture on Windows,
macOS and Linux (X11 and Wayland), and a rich canvas editor. It should be easy to build from
source and later ship as small installers.

## Options

| Option | Size | Notes |
|---|---|---|
| **Tauri 2 (Rust + system webview)** | ~5–15 MB | Native capture in Rust, web tech for the editor, built-in tray, hotkey, clipboard, updater and bundler |
| Electron | 100 MB+ | Mature, but heavy for an always-on tray app |
| Qt (C++) | medium | Used by ksnip/Flameshot; slower UI iteration |
| .NET Avalonia | medium | Good, smaller ecosystem for canvas editors |

## Decision

- **Tauri 2** as application shell.
- **Rust** for everything that is not UI, in a separate crate `screenbook-core`, so a CLI,
  HTTP API or MCP server can reuse it without Tauri.
- **React + TypeScript + Vite** for the UI; **Konva.js** for the editor (Phase 1).
- **xcap** for screen and window capture.

## Consequences

- Contributors need Rust and Node.js.
- Rendering differs slightly between webviews (WebView2, WKWebView, WebKitGTK); the editor
  must be tested on all three.
- Exporting annotated images without UI (CLI/API) requires a Rust renderer later.
