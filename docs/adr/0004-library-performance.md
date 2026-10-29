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
for 1–4 s. Criterion benchmarks for the core operations: `cargo bench -p zwopp-core
--bench library` (set `ZWOPP_BENCH_ITEMS` for larger libraries).

## Follow-ups (2026-10-27)

8. **Lossy thumbnails** with libwebp (`webp` crate, quality 80). Lossless thumbnails from
   before are recognised by their `VP8L` chunk and replaced in the background.
   `zenwebp` (pure Rust) was ruled out by its AGPL license.
9. **`thumb://` protocol** (`thumbs.rs`): `thumb://localhost/<id>?v=<updatedAt>`. A real
   thumbnail is sent as `immutable`, the original shown until it exists as `no-cache`.
   `LibraryItem` no longer carries a thumbnail path: checking which file exists cost
   ~0.1 ms per item on Windows, i.e. 25 ms of the 27 ms a page of 200 items took.
10. **Read pool:** one writer plus 4 read-only connections (round-robin, busy ones skipped).
    With WAL, reads never wait for a write such as a long reindex.
11. **Query tuning** found by the budget tests:
    - 32 MB page cache and 256 MB mmap per connection (default 2 MB cache: a page in the
      middle of 100 000 items took 14 ms, now < 1 ms warm, 5 ms cold).
    - Pages walk the ordering index (`INDEXED BY`), so a search with 10 000+ hits stops
      after one page instead of sorting all hits.
    - All words of ≥ 3 characters go into one FTS `MATCH` (3× faster than one per word).
    - Shorter words compare with the FTS content table: row by row when paging or when
      long words already narrowed the rows, as one scan when only counting.
12. **Budgets in CI** (`budgets` job, ubuntu): `crates/core/tests/budgets.rs` (release,
    100 000 items written straight into the index) and `apps/desktop/e2e/budgets.e2e.ts`
    (Playwright against the production build, Tauri mocked with 100 000 items).

13. **Faster on slow machines** (2026-10-27). The first CI run (GitHub's ubuntu runner,
    no GPU) passed, but the UI only just did: 94 of 100 ms for a scrollbar jump, 168 of
    200 ms to the first thumbnails. Profiling with the CPU throttled 4× showed the main
    thread busy with layout and paint, not with JavaScript:
    - The placeholders' shimmer animated `background-position`, which repaints every
      placeholder in every frame: ~50 ms per jump. Placeholders are static now.
    - 3 rows of overscan on each side meant ~30 off-screen cards to lay out per jump;
      now 1 row is rendered, and the data of 6 rows each side is fetched ahead instead.
      Visible pages always start loading at once, fetching ahead fills the remaining
      request slots.
    - Opening the library loaded everything twice: the initial query `{}` and the
      debounced `{favoritesOnly: false}` differ as cache keys, so the cache was dropped
      ~150 ms after the first page arrived.
    - The first page is requested together with the count, not after it.
    - No `loading="lazy"` on thumbnails: only rows near the view exist anyway, and lazy
      images are requested only after layout.

    With the CPU throttled 4×, open → first thumbnail went from 415 to 345 ms (median),
    the worst jump from ~180 to ~100 ms.

| Budget | Limit | Windows 11 dev machine | CI (ubuntu-24.04), before 13 |
|---|---|---|---|
| Open + count + first page (core) | 100 ms | 25 ms | 14 ms |
| Page in the middle / last page | 20 ms | 2 / 3 ms | 1 / 2 ms |
| Search count + first page ("chnung", "review", "re", "login rechnung 42") | 50 ms | 15–40 ms | 12–26 ms |
| Adding a 2560×1440 screenshot | 500 ms | 30 ms | 19 ms |
| UI: open → first thumbnails | 200 ms | ~90 ms | 168 ms |
| UI: longest frame while scrolling | 50 ms | 17 ms | 33 ms |
| UI: scrollbar jump → no empty cards | 100 ms | 25–50 ms | 94 ms |
| UI: search → results, after the 150 ms debounce | 50 ms | 35–45 ms | 21 ms |
| UI: DOM elements / heap growth after 40 jumps | 2000 / 10 MB | 226 / 3 MB | 308 / 3 MB |

Timings are medians after warming up every read connection once; the first query after
start can be a few ms slower. The UI timings on the dev machine vary by ±10 ms between runs.

## Consequences

- Offset pages can shift by a few items if the library changes while scrolling; the cache is
  dropped on every change notification, so this heals itself.
- Short search words (1–2 characters) are the slowest case in the core (~40 ms with 100 000
  items on the dev machine, 26 ms in CI); if that changes, they need an index of their own.- The UI budgets measure the frontend with a fixed 10 ms backend delay; the real backend is
  covered by the core budgets, not by an end-to-end test of the Tauri app.
