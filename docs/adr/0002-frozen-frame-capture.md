# ADR 0002: "Freeze first, select later" region capture

- Status: accepted
- Date: 2026-10-22

## Context

The user selects a region with the mouse. Capturing *after* the selection has drawbacks:
menus and tooltips close when the overlay appears, the screen can change while selecting,
and on Wayland applications may not read the screen freely at all.

## Decision

1. On hotkey, hide our own window and capture **every monitor in full** (`screenbook-core::capture`).
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