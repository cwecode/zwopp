# ADR 0004: Library performance for 100 000+ screenshots

- Status: accepted
- Date: 2026-10-22

## Context

The library should open instantly and scroll like a database table even with 100 000
screenshots, without freezing the UI (budgets in `docs/PLAN.md`, Phase 1.5). Before this
change the app loaded every item into memory and the DOM, compared every folder with every
index row on startup (quadratic), and generated thumbnails synchronously.

## Decisions

1. **Virtualized views.** The library grid and the editor filmstrip use TanStack Virtual:
   only the rows on screen exist in the DOM. Rows have a fixed height.
2. **Pages by offset, not keyset.** `Library::list_page(query, offset, limit)` plus
   `count(query)` and `position(id, query)`. Keyset pagination is cheaper for sequential
   reading, but a virtualized list must be able to jump anywhere (dragging the scrollbar).
   The offset is applied in a subquery over the ordering index (`rowid`s only), so skipped
   rows cost almost nothing; only the 200 rows of the page compute their tags.
3. **Frontend page cache** (`useLibraryPages`): pages of 200 items, at most 2 requests in
   flight, only the most recently visible range is requested (ranges scrolled past are never
   fetched), at most 40 pages kept (farthest evicted). Memory does not grow with the library.
4. **Search with an FTS5 trigram index** (`items_fts`: title, tags). Every search word must
   occur as a substring in title or tags, in any order. Words with ≥ 3 characters use the
   index (`MATCH` on a quoted phrase); shorter words scan the full-text table.
5. **SQLite tuning:** WAL journal, `synchronous = NORMAL`, indexes matching the sort order
   (`created_at DESC, id DESC`, also with `favorite`), cached prepared statements.
6. **Nothing slow on the UI path.** The app opens the index without scanning folders
   (`Library::open_index`); reindex (now linear with hash sets) and thumbnail generation
   run in a background thread and notify the UI via events. All library commands run on the
   blocking thread pool.
7. **Thumbnails:** 320 px lossless WebP (`thumb.webp`), generated in parallel (rayon).
   Until one exists the original is shown; old `thumb.png` files are replaced.

## Measurements (Windows 11, debug build of the app, 100 000 synthetic items)

| | Result |
|---|---|
| Seeding 100 000 items + import (release) | 129 s (one-off, test data only) |
| Generating 100 000 thumbnails in the background (release) | 56 s, UI usable meanwhile |
| Jump with the scrollbar to the middle / the end | cards filled in the first frame after release |
| Search "review" (24 999 hits) | result while typing, no visible delay |

Before the subquery and the "latest range only" loading, a jump to the end left placeholders
for 1–4 s. Criterion benchmarks for the core operations: `cargo bench -p screenbook-core
--bench library` (set `SCREENBOOK_BENCH_ITEMS` for larger libraries).

## Consequences

- Offset pages can shift by a few items if the library changes while scrolling; the cache is
  dropped on every change notification, so this heals itself.
- Lossless WebP thumbnails are ~25 % smaller than PNG but larger than lossy WebP; a lossy
  encoder (libwebp) and a dedicated `thumb://` protocol with cache headers are follow-ups.
- Budgets are not yet enforced in CI (needs UI profiling with Playwright).
