//! The screenshot library.
//!
//! Each item lives in its own folder so the original image is never
//! overwritten and annotations can be stored next to it later:
//!
//! ```text
//! <root>/items/<uuid>/
//!     original.png   untouched capture
//!     item.json      metadata
//! ```
//!
//! Phase 0 scans the folders; Phase 1 adds a SQLite index for search and tags.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::IoContext;
use crate::{Error, Result};

const ORIGINAL: &str = "original.png";
const METADATA: &str = "item.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub width: u32,
    pub height: u32,
    /// Absolute path of the original image. Not stored, filled in on load.
    #[serde(default, skip_deserializing)]
    pub original_path: PathBuf,
}

pub struct Library {
    items_dir: PathBuf,
}

impl Library {
    /// Opens (and creates, if needed) the library at `root`.
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let items_dir = root.as_ref().join("items");
        fs::create_dir_all(&items_dir).at(&items_dir)?;
        Ok(Self { items_dir })
    }

    /// Stores a new screenshot and returns its metadata.
    pub fn add(&self, image: &RgbaImage) -> Result<LibraryItem> {
        let id = Uuid::now_v7();
        let dir = self.items_dir.join(id.to_string());
        fs::create_dir_all(&dir).at(&dir)?;

        let original_path = dir.join(ORIGINAL);
        image.save(&original_path)?;

        let item = LibraryItem {
            id,
            created_at: Utc::now(),
            width: image.width(),
            height: image.height(),
            original_path,
        };
        let metadata = dir.join(METADATA);
        fs::write(&metadata, serde_json::to_vec_pretty(&item)?).at(&metadata)?;
        Ok(item)
    }

    /// Loads a single item.
    pub fn get(&self, id: Uuid) -> Result<LibraryItem> {
        let dir = self.items_dir.join(id.to_string());
        if !dir.is_dir() {
            return Err(Error::ItemNotFound(id));
        }
        load(&dir)
    }

    /// Lists all items, newest first. Broken item folders are skipped.
    pub fn list(&self) -> Result<Vec<LibraryItem>> {
        let entries = fs::read_dir(&self.items_dir).at(&self.items_dir)?;
        let mut items: Vec<_> = entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().is_dir())
            .filter_map(|entry| load(&entry.path()).ok())
            .collect();
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok(items)
    }

    /// Removes an item and all its files.
    pub fn delete(&self, id: Uuid) -> Result<()> {
        let dir = self.items_dir.join(id.to_string());
        if !dir.is_dir() {
            return Err(Error::ItemNotFound(id));
        }
        fs::remove_dir_all(&dir).at(&dir)
    }
}

fn load(dir: &Path) -> Result<LibraryItem> {
    let metadata = dir.join(METADATA);
    let bytes = fs::read(&metadata).at(&metadata)?;
    let mut item: LibraryItem = serde_json::from_slice(&bytes)?;
    item.original_path = dir.join(ORIGINAL);
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_list_get_delete() {
        let root = tempfile::tempdir().unwrap();
        let library = Library::open(root.path()).unwrap();

        let first = library.add(&RgbaImage::new(4, 3)).unwrap();
        let second = library.add(&RgbaImage::new(8, 6)).unwrap();
        assert!(first.original_path.is_file());

        let ids: Vec<_> = library.list().unwrap().iter().map(|i| i.id).collect();
        assert_eq!(ids, [second.id, first.id]);
        assert_eq!(library.get(first.id).unwrap().width, 4);

        library.delete(first.id).unwrap();
        assert_eq!(library.list().unwrap().len(), 1);
        assert!(matches!(library.get(first.id), Err(Error::ItemNotFound(_))));
    }

    #[test]
    fn broken_items_are_skipped() {
        let root = tempfile::tempdir().unwrap();
        let library = Library::open(root.path()).unwrap();
        library.add(&RgbaImage::new(1, 1)).unwrap();
        fs::create_dir_all(root.path().join("items").join("garbage")).unwrap();
        assert_eq!(library.list().unwrap().len(), 1);
    }
}
