# ADR 0003: Library storage – item folders plus a SQLite index

- Status: accepted
- Date: 2026-10-22

## Context

The library must list hundreds or thousands of screenshots quickly, support search, tags and
favorites, and keep annotations editable. Users should not lose screenshots if an index gets
corrupted, and the data should stay understandable without Screenbook.

## Decision

- **One folder per item** (`items/<uuid>/`) with `original.png` (never overwritten),
  `item.json` (metadata), `document.json` (annotations), `render.png` (annotated image) and
  `thumb.png` (≤ 400 px preview).
- **The folders are the source of truth.** `library.db` (SQLite, bundled via `rusqlite`) is an
  index with the tables `items` and `tags`. On startup `Library::open` syncs it with the folders:
  unknown folders are imported, rows of deleted folders are dropped. Deleting the database is
  therefore always safe.
- Schema changes use SQLite's `user_version` with forward-only migrations in `library.rs`.
- Metadata changes are written to both `item.json` and the index.
- The editor renders `render.png` in the webview and sends it as a raw IPC body; the core only
  validates it is a PNG. A Rust renderer can replace this later without changing the format.
- UUID v7 ids sort by creation time.

## Consequences

- Backups and sync tools (Dropbox, Syncthing) work on plain files.
- Search is `LIKE` on title and tags for now; full-text search (FTS5) and OCR text can be added
  as new index tables later.
- Each metadata write touches two places; a crash in between is healed by the next reindex only
  for new/removed items, not for changed metadata. Acceptable for now.
