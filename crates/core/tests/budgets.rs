//! Performance budgets of the library core (docs/PLAN.md, Phase 1.5), checked
//! in CI. Timings only mean something in a release build:
//!
//! ```text
//! cargo test -p screenbook-core --release --test budgets -- --ignored --nocapture
//! ```
//!
//! The budgets for the UI (first thumbnails, scrolling, memory) are checked by
//! `apps/desktop/e2e/budgets.spec.ts`; this test covers the core part of them.

use std::hint::black_box;
use std::time::{Duration, Instant};

use image::{Rgba, RgbaImage};
use screenbook_core::library::{Library, ListQuery};
use screenbook_core::testing;

const ITEMS: usize = 100_000;
const PAGE: u32 = 200;
/// Every measurement is the median of this many runs, after warming up.
const RUNS: usize = 7;
/// The library reads through a few connections, each with its own page cache;
/// one run per connection first measures the steady state while scrolling
/// and typing, not the first query after start.
const WARM_UP: usize = 4;

fn ms(n: u64) -> Duration {
    Duration::from_millis(n)
}

fn median(mut run: impl FnMut()) -> Duration {
    (0..WARM_UP).for_each(|_| run());
    let mut times: Vec<Duration> = (0..RUNS)
        .map(|_| {
            let started = Instant::now();
            run();
            started.elapsed()
        })
        .collect();
    times.sort();
    times[RUNS / 2]
}

fn search(text: &str) -> ListQuery {
    ListQuery {
        search: Some(text.into()),
        ..Default::default()
    }
}

/// A 1440p "screenshot" with flat areas and text-like detail, so PNG and
/// thumbnail encoding cost about as much as for a real one.
fn screenshot() -> RgbaImage {
    RgbaImage::from_fn(2560, 1440, |x, y| {
        let text = (y / 18) % 3 == 0 && (x / 7 + y / 3) % 5 < 2;
        if text {
            Rgba([30, 30, 40, 255])
        } else if x < 280 {
            Rgba([235, 238, 245, 255])
        } else {
            Rgba([255, 255, 255, 255])
        }
    })
}

#[test]
#[ignore = "timing test for release builds, run by CI"]
fn library_meets_budgets_with_100_000_items() {
    let root = tempfile::tempdir().unwrap();
    drop(testing::seed_index(root.path(), ITEMS).unwrap());

    let all = ListQuery::default();
    let favorites = ListQuery {
        favorites_only: true,
        ..Default::default()
    };
    let mut results: Vec<(&str, Duration, Duration)> = Vec::new();
    let mut check = |name, budget, time| results.push((name, budget, time));

    // Opening the library, the first page and the count for the scrollbar
    // are part of "library open → first thumbnails < 200 ms".
    check(
        "open + count + first page",
        ms(100),
        median(|| {
            let library = Library::open_index(root.path()).unwrap();
            library.count(&all).unwrap();
            library.list_page(&all, 0, PAGE).unwrap();
        }),
    );

    let library = Library::open_index(root.path()).unwrap();
    // A jump with the scrollbar must not leave empty cards for long (< 100 ms).
    for (name, offset) in [
        ("page in the middle", ITEMS as u64 / 2),
        ("last page", ITEMS as u64 - PAGE as u64),
    ] {
        check(
            name,
            ms(20),
            median(|| {
                black_box(library.list_page(&all, offset, PAGE).unwrap());
            }),
        );
    }
    let oldest = library
        .list_page(&all, ITEMS as u64 - 1, 1)
        .unwrap()
        .remove(0);
    check(
        "position of the oldest item",
        ms(50),
        median(|| {
            black_box(library.position(oldest.id, &all).unwrap());
        }),
    );

    // Typing a search → result < 50 ms (count + first page).
    for (name, query) in [
        ("search 'chnung' (substring)", search("chnung")),
        ("search 'review' (tag)", search("review")),
        ("search 're' (short word)", search("re")),
        ("search 'login rechnung 42'", search("login rechnung 42")),
        ("favorites", favorites),
    ] {
        check(
            name,
            ms(50),
            median(|| {
                library.count(&query).unwrap();
                library.list_page(&query, 0, PAGE).unwrap();
            }),
        );
    }

    // Screenshot → editor < 500 ms: storing original, thumbnail and index row.
    let image = screenshot();
    check(
        "add a 2560×1440 screenshot",
        ms(500),
        median(|| {
            black_box(library.add(&image).unwrap());
        }),
    );

    println!(
        "\n{:<32} {:>10} {:>10}",
        "budget (median)", "limit", "measured"
    );
    for (name, budget, time) in &results {
        let mark = if time <= budget { "ok" } else { "OVER" };
        println!("{name:<32} {budget:>10.0?} {time:>10.1?}  {mark}");
    }
    let over: Vec<_> = results.iter().filter(|(_, b, t)| t > b).collect();
    assert!(over.is_empty(), "over budget: {over:?}");
}
