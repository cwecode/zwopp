# ADR 0006: Settings and quick styles

- Status: accepted
- Date: 2026-10-28

## Context

Phase 2 adds a settings page (language, capture hotkey, library folder, what happens after
a capture) and quick styles: named tool styles that can be saved, applied and shared. The
editor should also start each tool with the style used last time.

## Decision

1. **One JSON file, owned by the core.** `screenbook_core::settings::Settings` is stored as
   `settings.json` in the app's config folder (not in the library, because the library
   folder is itself a setting). Missing fields take their defaults, so older files keep
   working; a broken file is renamed to `settings.json.broken` and the defaults apply.
   Writes go through a `.partial` file and a rename.
2. **The backend applies, every window follows.** `save_settings` registers a new hotkey
   first and refuses the change if it is taken (the old hotkey stays), then stores the file
   and emits `settings:changed`. Each window keeps a copy (`settings/store.ts`) and switches
   its language from it, so the capture overlays follow too.
3. **Editor data is opaque to Rust.** Last-used tool styles and quick styles live under
   `settings.editor` as JSON the core stores as it comes. Only the editor knows their shape,
   and it checks every field when reading (`readEditorSettings`), so a hand-edited or
   shared file cannot break the editor.
4. **Quick styles belong to a tool.** A quick style is a name, a tool and the fields that
   tool uses (`styleFor`). The editor shows the current tool's quick styles after the style
   controls; a click or the keys 1–9 apply one, "+" saves the current style. They are shared
   as a small JSON file (`format: "screenbook-quick-styles"`, `version: 1`); importing adds
   them with new ids.
5. **A new library folder applies after a restart.** The open library, its background
   indexing and the thumbnail protocol all hold the folder; switching it live would need
   all of them to be replaceable. The settings page offers "Restart now" instead.
   Existing screenshots are not moved. `SCREENBOOK_LIBRARY_DIR` still wins over the setting.
6. **Settings load alongside the first render.** The window does not wait for them; only a
   language other than the system's changes what was drawn first.

## Consequences

- A CLI or HTTP API (v2) can read the same file through the core.
- The hotkey recorder accepts combinations with Ctrl/⌘ or Alt, or function keys and Print
  on their own, so a hotkey never swallows a typed letter.
