//! Synthetic libraries for benchmarks and manual performance tests.
//! Not part of the stable API.

use std::fs;
use std::path::Path;

use chrono::{Duration, Utc};
use image::RgbaImage;
use rayon::prelude::*;
use uuid::Uuid;

use crate::Result;
use crate::error::IoContext;
use crate::library::Library;

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
        let id = Uuid::now_v7();
        let dir = items.join(id.to_string());
        fs::create_dir_all(&dir).at(&dir)?;
        fs::write(dir.join("original.png"), &png).at(&dir)?;
        let title = format!(
            "{} {} {i}",
            WORDS[i % WORDS.len()],
            WORDS[(i / 7) % WORDS.len()]
        );
        let metadata = serde_json::json!({
            "id": id,
            "createdAt": start + Duration::minutes(i as i64),
            "width": 64,
            "height": 40,
            "title": title,
            "favorite": i % 50 == 0,
            "tags": [TAGS[i % TAGS.len()], TAGS[(i / 3) % TAGS.len()]],
        });
        let path = dir.join("item.json");
        fs::write(&path, serde_json::to_vec(&metadata)?).at(&path)
    })?;

    Library::open(root)
}
