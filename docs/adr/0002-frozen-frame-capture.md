# ADR 0002: "Freeze first, select later" region capture

- Status: accepted
- Date: 2026-10-22

## Context

The user selects a region with the mouse. Capturing *after* the selection has drawbacks:
menus and tooltips close when the overlay appears, the screen can change while selecting,
and on Wayland applications may not read the screen freely at all.

## Decision

1. On hotkey, hide our own window and capture **every monitor in full** (`zwopp-core::capture`).
2. Open one borderless, always-on-top overlay window per monitor that displays the frozen frame.
3. The user drags a rectangle (click = whole monitor, Esc / right-click = cancel).
4. The overlay converts CSS pixels to frame pixels using the ratio
   `image.naturalWidth / image.clientWidth`, so mixed DPI setups need no special handling.
5. The backend crops the region from the frozen frame, stores it in the library and copies
   it to the clipboard.

Monitors are matched between Tauri (window placement) and xcap (capture) via the monitor's
center point; on macOS the point is converted from physical pixels to points.

## Consequences

- What you see is exactly what you get; transient UI stays capturable.
- Memory: one RGBA frame per monitor is held during selection (≈33 MB per 4K monitor).
- On macOS the overlay does not cover the menu bar yet (needs a higher window level).
- On Wayland the portal may show its own permission dialog on first use.

## Update 2026-10-28: windows, selections across monitors, delay

- **Desktop pixels.** Overlays work in one coordinate space for all monitors: each frozen
  frame keeps its monitor's top-left corner (physical pixels). A drag that leaves its
  monitor keeps going (pointer capture); every overlay draws its part of the selection,
  shared through Tauri events. `capture::compose` joins the parts; gaps between monitors
  of different sizes stay transparent. One overlay spanning the virtual desktop was ruled
  out: a window has one DPI on Windows, and macOS keeps windows on one display.
- **Windows** are listed together with the freeze (`capture::windows`, xcap: visible
  bounds without the invisible resize border, topmost first, minimized and own windows
  left out). Hover highlights the window, a click cuts it from the frozen frame — what was
  visible, including anything overlapping it. Shift+click or the bare desktop gives the
  whole monitor.
- **Delay** (3/5/10 s): our window hides at once, the freeze follows after the delay.
- **Magnifier**: 15 × 15 pixels around the cursor at 8×, with position and colour.
## Update 2026-10-28: speed

A capture in `npm run dev` took 1–2 s until the overlay appeared and about 1 s from the
click to the editor. Measured causes and fixes:

- **Unoptimized dependencies** in dev builds: PNG/WebP encoding and screen capture were
  10–70× slower than in release. Dependencies and `zwopp-core` are now built with
  `opt-level = 3` in dev too (`Cargo.toml`); the app crate stays unoptimized for fast rebuilds.
- **New overlay windows per capture**: starting a webview and loading the UI took ~1 s.
  The overlays are created once (at startup) and only hidden between captures; the backend
  emits `capture:start` and they load the new frame.
- **Previews** are PNG-encoded once, right after the freeze and in parallel for all monitors.
- **The hidden main window** is throttled by WebView2 and took ~1 s to open the editor.
  On Windows it now stays visible: for the moment of the freeze it is excluded from
  captures (`SetWindowDisplayAffinity`), then shown to screen sharing again. Elsewhere, and
  with a delay, it is still hidden.
- The clipboard copy runs after the editor opens.

Result (debug build, 3440×1440 + 1920×1080): hotkey → overlays have their frames 0.23 s
(was 1.1–1.6 s), click → editor loads the screenshot 0.22 s (was 0.96 s).