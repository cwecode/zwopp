//! Synthetic libraries for benchmarks and manual performance tests.
//! Not part of the stable API.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Duration, Utc};
use image::RgbaImage;
use rayon::prelude::*;
use uuid::Uuid;

use crate::Result;
use crate::error::IoContext;
use crate::library::{Library, Metadata};

const WORDS: &[&str] = &[
    "Rechnung",
    "Login",
    "Dialog",
    "Fehler",
    "Bestellung",
    "Kunde",
    "Dashboard",
    "Export",
    "Einstellungen",
    "Profil",
    "Bericht",
    "Angebot",
    "Vertrag",
    "Ticket",
    "Release",
    "Meeting",
];
const APPS: &[&str] = &["Firefox", "Excel", "Outlook", "Visual Studio Code", "Teams"];
const TAGS: &[&str] = &[
    "bug", "ui", "doku", "kunde", "intern", "review", "design", "support",
];

/// Writes `count` item folders into `root/items` (tiny images, varied titles,
/// tags and dates, one minute apart) and opens the library, which imports them.
pub fn seed(root: &Path, count: usize) -> Result<Library> {
    let items = root.join("items");
    fs::create_dir_all(&items).at(&items)?;

    let mut png = Vec::new();
    RgbaImage::from_fn(64, 40, |x, y| {
        image::Rgba([(x * 4) as u8, (y * 6) as u8, 160, 255])
    })
    .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;

    let start = Utc::now() - Duration::minutes(count as i64);
    (0..count).into_par_iter().try_for_each(|i| -> Result<()> {
        let metadata = metadata(i, start);
        let dir = items.join(metadata.id.to_string());
        fs::create_dir_all(&dir).at(&dir)?;
        fs::write(dir.join("original.png"), &png).at(&dir)?;
        let path = dir.join("item.json");
        fs::write(&path, serde_json::to_vec(&metadata)?).at(&path)
    })?;

    Library::open(root)
}

/// Like [`seed`], but writes only the index (no folders, no images), which
/// takes seconds instead of minutes for 100 000 items. Good for measuring
/// listing and search; the library must be opened with
/// [`Library::open_index`], since a reindex would drop these rows.
pub fn seed_index(root: &Path, count: usize) -> Result<Library> {
    let library = Library::open_index(root)?;
    let start = Utc::now() - Duration::minutes(count as i64);
    let items: Vec<Metadata> = (0..count).map(|i| metadata(i, start)).collect();
    library.index_only(&items)?;
    Ok(library)
}

/// Item `i` of a synthetic library: 1 in 50 is a favorite, two tags each,
/// and every sixth has no application.
fn metadata(i: usize, start: DateTime<Utc>) -> Metadata {
    let created_at = start + Duration::minutes(i as i64);
    Metadata {
        id: Uuid::now_v7(),
        created_at,
        updated_at: Some(created_at),
        width: 64,
        height: 40,
        title: format!(
            "{} {} {i}",
            WORDS[i % WORDS.len()],
            WORDS[(i / 7) % WORDS.len()]
        ),
        favorite: i.is_multiple_of(50),
        tags: vec![
            TAGS[i % TAGS.len()].to_owned(),
            TAGS[(i / 3) % TAGS.len()].to_owned(),
        ],
        app: APPS.get(i % (APPS.len() + 1)).map(|&a| a.to_owned()),
    }
}
