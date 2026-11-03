# ADR 0009: Capture modes – panorama and GIF

- Status: accepted
- Date: 2026-11-03

## Context

Besides still screenshots, users want long pages in one image (scrolling capture) and
short click sequences as GIFs to send around, later also video. All of them start the
same way: pick an area of the screen.

## Decision

1. **One overlay, several modes.** The capture overlay gets a mode bar at the bottom
   (screenshot, panorama, GIF; video disabled as "coming soon"), switched with a click,
   ←/→ or Tab. The area is selected the same way in every mode; the mode stays for the
   next capture.
2. **Recordings capture the live screen.** For panorama and GIF the frozen frame only
   serves to pick the area. Then the overlays hide and `recording.rs` captures that area
   of its monitor (`capture::Region`) again and again, 20 times a second for a panorama,
   15 for a GIF. A dashed frame (click-through) and a bar with progress, **Done** and
   cancel sit outside the area; on Windows they are also excluded from captures. The
   capture hotkey ends a recording too.
3. **Panorama stitching** (`record::Panorama`) compares rows by hash: rows that stay in
   place at the top and bottom are a fixed header or footer and are kept once; in
   between, the shift is where at least 90 % of the overlapping rows match (with a few
   rows that are not one plain colour, so blank space alone does not decide). New rows go
   above the footer. Without a match (scrolled too far at once) the frame is skipped and
   the bar says so. Only scrolling down; up to 30 000 px.
4. **GIFs** (`record::GifRecorder`, `gif` crate): each frame stores only the rectangle
   that changed, identical frames lengthen the previous one; encoding runs on its own
   thread and frames that do not fit into its queue are skipped. The mouse pointer is
   drawn in, clicks as a yellow ring (Windows). Up to 60 s.
5. **Library:** a recording is an item with `animation.gif` next to `original.png` (its
   first frame, used for thumbnails and dimensions), `animated` in `item.json` and the
   index (schema 4). Export, drag and copy hand over the GIF; copying puts the file on the
   clipboard (Windows `CF_HDROP`), since a GIF as an image would lose its animation.
   Editing GIFs is out of scope for now; the editor stays for still images.

## Consequences

- Recordings cover one monitor (the one under the centre of the area).
- A panorama is a normal still image afterwards and can be annotated like any screenshot.
- Open points are in PLAN.md, section 5.0 (auto-scroll, editing GIFs, video, per-mode
  hotkeys).
