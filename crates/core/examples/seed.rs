//! Fills a library with synthetic items for performance testing.
//!
//! ```text
//! cargo run -p screenbook-core --release --example seed -- <library-dir> [count]
//! ```
//!
//! To try it in the app, point it at a copy of the app's library folder
//! (`%APPDATA%\digital.weier.screenbook\library` on Windows).

use std::time::Instant;

use screenbook_core::library::ListQuery;
use screenbook_core::testing;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let root = args.next().ok_or("usage: seed <library-dir> [count]")?;
    let count: usize = args
        .next()
        .map(|c| c.parse())
        .transpose()?
        .unwrap_or(10_000);

    let started = Instant::now();
    let library = testing::seed(root.as_ref(), count)?;
    println!("seeded {count} items in {:.1?}", started.elapsed());

    let started = Instant::now();
    let made = library.ensure_thumbnails()?;
    println!("made {made} thumbnails in {:.1?}", started.elapsed());

    println!(
        "library now has {} items",
        library.count(&ListQuery::default())?
    );
    Ok(())
}
