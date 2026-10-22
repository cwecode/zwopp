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
- Selections cannot yet span multiple monitors (later: virtual-desktop overlay).
- On macOS the overlay does not cover the menu bar yet (needs a higher window level).
- On Wayland the portal may show its own permission dialog on first use.
