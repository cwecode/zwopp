//! Library performance against the budgets in docs/PLAN.md (Phase 1.5).
//!
//! ```text
//! cargo bench -p screenbook-core --bench library
//! SCREENBOOK_BENCH_ITEMS=100000 cargo bench -p screenbook-core --bench library
//! ```

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use screenbook_core::library::{Library, ListQuery};
use screenbook_core::testing;

const PAGE: u32 = 200;

fn bench(c: &mut Criterion) {
    let count: usize = std::env::var("SCREENBOOK_BENCH_ITEMS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20_000);
    let root = tempfile::tempdir().unwrap();
    testing::seed(root.path(), count).unwrap();

    let all = ListQuery::default();
    let search = |text: &str| ListQuery {
        search: Some(text.into()),
        ..Default::default()
    };
    let favorites = ListQuery {
        favorites_only: true,
        ..Default::default()
    };
    let middle = (count / 2) as u64;

    let mut group = c.benchmark_group(format!("library/{count}"));
    group.bench_function("open (index only)", |b| {
        b.iter(|| black_box(Library::open_index(root.path()).unwrap()))
    });
    let library = Library::open_index(root.path()).unwrap();
    group.bench_function("reindex (no changes)", |b| {
        b.iter(|| library.reindex().unwrap())
    });
    group.bench_function("first page", |b| {
        b.iter(|| black_box(library.list_page(&all, 0, PAGE).unwrap()))
    });
    group.bench_function("page in the middle", |b| {
        b.iter(|| black_box(library.list_page(&all, middle, PAGE).unwrap()))
    });
    group.bench_function("count", |b| {
        b.iter(|| black_box(library.count(&all).unwrap()))
    });
    group.bench_function("search 'chnung' (count + page)", |b| {
        let q = search("chnung");
        b.iter(|| {
            black_box((
                library.count(&q).unwrap(),
                library.list_page(&q, 0, PAGE).unwrap(),
            ))
        })
    });
    group.bench_function("search tag 'review' (count + page)", |b| {
        let q = search("review");
        b.iter(|| {
            black_box((
                library.count(&q).unwrap(),
                library.list_page(&q, 0, PAGE).unwrap(),
            ))
        })
    });
    group.bench_function("favorites (count + page)", |b| {
        b.iter(|| {
            black_box((
                library.count(&favorites).unwrap(),
                library.list_page(&favorites, 0, PAGE).unwrap(),
            ))
        })
    });
    group.finish();
}

criterion_group! {
    name = benches;
    config = Criterion::default().sample_size(20);
    targets = bench
}
criterion_main!(benches);
