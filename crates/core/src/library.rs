//! The screenshot library.
//!
//! Each item lives in its own folder. The folders are the source of truth; the
//! SQLite database is an index for fast listing and search that can always be
//! rebuilt from them (see `docs/adr/0003-library-storage.md`):
//!
//! ```text
//! <root>/
//!     library.db             index (items, tags)
//!     items/<uuid>/
//!         original.png       untouched capture, never overwritten
//!         item.json          metadata (title, tags, favorite, …)
//!         document.json      annotations, see docs/spec/document-format.md
//!         render.png         original + annotations, written by the editor
//!         thumb.webp         small preview for the library grid
//!         assets/<uuid>.png  extra images used by the document (pasted content)
//! ```
//!
//! Built to stay fast with 100 000+ items (see `docs/adr/0004-library-performance.md`):
//! pages are fetched by offset from a covering index, search uses an FTS5
//! trigram index, and thumbnails are generated in the background.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use image::RgbaImage;
use rayon::prelude::*;
use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, Row, params, params_from_iter};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::IoContext;
use crate::{Error, Result};

const DATABASE: &str = "library.db";
const ORIGINAL: &str = "original.png";
const METADATA: &str = "item.json";
const DOCUMENT: &str = "document.json";
const RENDER: &str = "render.png";
const THUMB: &str = "thumb.webp";
/// PNG thumbnails written before version 0.2; replaced in the background.
const LEGACY_THUMB: &str = "thumb.png";
const ASSETS: &str = "assets";

/// Longest edge of generated thumbnails, in pixels.
pub const THUMB_SIZE: u32 = 320;

/// Current database schema, stored in SQLite's `user_version`.
const SCHEMA_VERSION: i32 = 2;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub width: u32,
    pub height: u32,
    pub title: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub has_annotations: bool,
    pub original_path: PathBuf,
    /// The annotated image, if the item was edited.
    pub render_path: Option<PathBuf>,
    /// Preview image: the thumbnail, or the original while none exists yet.
    pub thumb_path: PathBuf,
}

/// Filter for [`Library::list`].
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListQuery {
    /// Matches title or tags, case-insensitive.
    pub search: Option<String>,
    pub favorites_only: bool,
}

/// Fields to change in [`Library::update`]; `None` leaves a field as it is.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ItemUpdate {
    pub title: Option<String>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
}

/// The contents of `item.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    id: Uuid,
    created_at: DateTime<Utc>,
    #[serde(default)]
    updated_at: Option<DateTime<Utc>>,
    width: u32,
    height: u32,
    #[serde(default)]
    title: String,
    #[serde(default)]
    favorite: bool,
    #[serde(default)]
    tags: Vec<String>,
}

pub struct Library {
    items_dir: PathBuf,
    db: Mutex<Connection>,
}

impl Library {
    /// Opens (and creates, if needed) the library at `root` and brings the
    /// index in sync with the item folders.
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let library = Self::open_index(root)?;
        library.reindex()?;
        Ok(library)
    }

    /// Opens the library without scanning the item folders. The index may be
    /// out of date until [`Library::reindex`] ran, which callers can do in the
    /// background so a large library opens instantly.
    pub fn open_index(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref();
        let items_dir = root.join("items");
        fs::create_dir_all(&items_dir).at(&items_dir)?;

        let db = Connection::open(root.join(DATABASE))?;
        // WAL lets reads run while a write is in progress and makes commits cheap.
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.pragma_update(None, "synchronous", "NORMAL")?;
        migrate(&db)?;
        Ok(Self {
            items_dir,
            db: Mutex::new(db),
        })
    }

    /// Stores a new screenshot and returns its metadata.
    pub fn add(&self, image: &RgbaImage) -> Result<LibraryItem> {
        let now = Utc::now();
        let metadata = Metadata {
            id: Uuid::now_v7(),
            created_at: now,
            updated_at: Some(now),
            width: image.width(),
            height: image.height(),
            title: String::new(),
            favorite: false,
            tags: Vec::new(),
        };
        let dir = self.dir(metadata.id);
        fs::create_dir_all(&dir).at(&dir)?;
        image.save(dir.join(ORIGINAL))?;
        save_thumbnail(&dir, image)?;
        write_metadata(&dir, &metadata)?;

        let db = self.db.lock().unwrap();
        upsert(&db, &metadata, false)?;
        get(&db, &self.items_dir, metadata.id)
    }

    /// Loads a single item.
    pub fn get(&self, id: Uuid) -> Result<LibraryItem> {
        get(&self.db.lock().unwrap(), &self.items_dir, id)
    }

    /// Lists all items matching `query`, newest first.
    pub fn list(&self, query: &ListQuery) -> Result<Vec<LibraryItem>> {
        self.list_page(query, 0, u32::MAX)
    }

    /// One page of items matching `query`, newest first.
    ///
    /// Pages are addressed by offset so a virtualized list can jump anywhere
    /// (e.g. dragging the scrollbar); with the ordering index SQLite skips
    /// even 100 000 rows in a few milliseconds.
    pub fn list_page(
        &self,
        query: &ListQuery,
        offset: u64,
        limit: u32,
    ) -> Result<Vec<LibraryItem>> {
        let filter = Filter::new(query);
        let [limit_at, offset_at] = filter.extra();
        let db = self.db.lock().unwrap();
        // The offset is applied to bare rowids from the ordering index first;
        // only the rows of the page then pay for the full columns (tags).
        let mut stmt = db.prepare_cached(&format!(
            "{SELECT_ITEMS} WHERE items.rowid IN (
                 SELECT rowid FROM items WHERE {}
                 ORDER BY created_at DESC, id DESC LIMIT ?{limit_at} OFFSET ?{offset_at})
             ORDER BY created_at DESC, id DESC",
            filter.sql
        ))?;
        let params = filter.params_with([Value::from(limit), Value::from(offset as i64)]);
        let rows = stmt.query_map(params_from_iter(params), |row| {
            read_item(row, &self.items_dir)
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Number of items matching `query`.
    pub fn count(&self, query: &ListQuery) -> Result<u64> {
        let filter = Filter::new(query);
        let db = self.db.lock().unwrap();
        let count: i64 = db
            .prepare_cached(&format!("SELECT COUNT(*) FROM items WHERE {}", filter.sql))?
            .query_row(params_from_iter(&filter.params), |row| row.get(0))?;
        Ok(count as u64)
    }

    /// Index of item `id` in the list for `query`, or None if it does not match.
    pub fn position(&self, id: Uuid, query: &ListQuery) -> Result<Option<u64>> {
        let filter = Filter::new(query);
        let [first, second] = filter.extra();
        let db = self.db.lock().unwrap();
        let id = id.to_string();
        let Some(created_at) = db
            .query_row(
                &format!(
                    "SELECT created_at FROM items WHERE id = ?{first} AND {}",
                    filter.sql
                ),
                params_from_iter(filter.params_with([Value::from(id.clone())])),
                |row| row.get::<_, String>(0),
            )
            .optional()?
        else {
            return Ok(None);
        };
        let newer: i64 = db.query_row(
            &format!(
                "SELECT COUNT(*) FROM items WHERE {} AND (created_at, id) > (?{first}, ?{second})",
                filter.sql
            ),
            params_from_iter(filter.params_with([Value::from(created_at), Value::from(id)])),
            |row| row.get(0),
        )?;
        Ok(Some(newer as u64))
    }

    /// All tags in use, alphabetically.
    pub fn tags(&self) -> Result<Vec<String>> {
        let db = self.db.lock().unwrap();
        let mut stmt = db.prepare("SELECT DISTINCT tag FROM tags ORDER BY tag COLLATE NOCASE")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Changes title, favorite flag and/or tags.
    pub fn update(&self, id: Uuid, update: ItemUpdate) -> Result<LibraryItem> {
        let dir = self.existing_dir(id)?;
        let mut metadata = read_metadata(&dir)?;
        if let Some(title) = update.title {
            metadata.title = title.trim().to_owned();
        }
        if let Some(favorite) = update.favorite {
            metadata.favorite = favorite;
        }
        if let Some(tags) = update.tags {
            metadata.tags = normalize_tags(tags);
        }
        metadata.updated_at = Some(Utc::now());
        write_metadata(&dir, &metadata)?;

        let db = self.db.lock().unwrap();
        upsert(&db, &metadata, dir.join(RENDER).is_file())?;
        get(&db, &self.items_dir, id)
    }

    /// The annotation document of an item, if it was ever edited.
    pub fn load_document(&self, id: Uuid) -> Result<Option<serde_json::Value>> {
        let path = self.existing_dir(id)?.join(DOCUMENT);
        if !path.is_file() {
            return Ok(None);
        }
        let bytes = fs::read(&path).at(&path)?;
        Ok(Some(serde_json::from_slice(&bytes)?))
    }

    /// Stores the annotation document. The document is opaque to the core
    /// except for its `schemaVersion`, see `docs/spec/document-format.md`.
    pub fn save_document(&self, id: Uuid, document: &serde_json::Value) -> Result<()> {
        if document
            .get("schemaVersion")
            .and_then(|v| v.as_u64())
            .is_none()
        {
            return Err(Error::InvalidDocument("missing schemaVersion".into()));
        }
        let path = self.existing_dir(id)?.join(DOCUMENT);
        fs::write(&path, serde_json::to_vec_pretty(document)?).at(&path)
    }

    /// Stores the annotated image (PNG) produced by the editor and refreshes
    /// the thumbnail.
    pub fn save_render(&self, id: Uuid, png: &[u8]) -> Result<LibraryItem> {
        let dir = self.existing_dir(id)?;
        let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)?.to_rgba8();
        let path = dir.join(RENDER);
        fs::write(&path, png).at(&path)?;
        save_thumbnail(&dir, &image)?;

        let mut metadata = read_metadata(&dir)?;
        metadata.updated_at = Some(Utc::now());
        write_metadata(&dir, &metadata)?;

        let db = self.db.lock().unwrap();
        upsert(&db, &metadata, true)?;
        get(&db, &self.items_dir, id)
    }

    /// Stores an extra image used by the item's document (e.g. a screenshot
    /// pasted from another item) and returns its file name.
    pub fn save_asset(&self, id: Uuid, png: &[u8]) -> Result<String> {
        let dir = self.existing_dir(id)?.join(ASSETS);
        image::load_from_memory_with_format(png, image::ImageFormat::Png)?;
        fs::create_dir_all(&dir).at(&dir)?;
        let name = format!("{}.png", Uuid::now_v7());
        let path = dir.join(&name);
        fs::write(&path, png).at(&path)?;
        Ok(name)
    }

    /// Reads an asset written by [`Library::save_asset`].
    pub fn read_asset(&self, id: Uuid, name: &str) -> Result<Vec<u8>> {
        // Names are generated by us; anything else could escape the folder.
        let valid = name
            .strip_suffix(".png")
            .is_some_and(|stem| stem.parse::<Uuid>().is_ok());
        if !valid {
            return Err(Error::InvalidAsset(name.to_owned()));
        }
        let path = self.existing_dir(id)?.join(ASSETS).join(name);
        fs::read(&path).at(&path)
    }

    /// The image to share or copy: the render if there is one, else the original.
    pub fn output_path(&self, id: Uuid) -> Result<PathBuf> {
        let item = self.get(id)?;
        Ok(item.render_path.unwrap_or(item.original_path))
    }

    /// Removes an item and all its files.
    pub fn delete(&self, id: Uuid) -> Result<()> {
        let dir = self.existing_dir(id)?;
        fs::remove_dir_all(&dir).at(&dir)?;
        self.db
            .lock()
            .unwrap()
            .execute("DELETE FROM items WHERE id = ?1", [id.to_string()])?;
        Ok(())
    }

    /// Syncs the index with the item folders: imports folders the index does
    /// not know and drops index rows whose folder is gone.
    pub fn reindex(&self) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        let known: HashSet<String> = {
            let mut stmt = tx.prepare("SELECT id FROM items")?;
            stmt.query_map([], |row| row.get(0))?
                .collect::<Result<_, _>>()?
        };
        let mut present = HashSet::with_capacity(known.len());
        let entries = fs::read_dir(&self.items_dir).at(&self.items_dir)?;
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if known.contains(&name) {
                present.insert(name);
                continue;
            }
            let dir = entry.path();
            // Folders without valid metadata are left alone, not deleted.
            let Ok(metadata) = read_metadata(&dir) else {
                continue;
            };
            upsert(&tx, &metadata, dir.join(RENDER).is_file())?;
        }
        for id in known.difference(&present) {
            tx.execute("DELETE FROM items WHERE id = ?1", [id])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Creates missing thumbnails (in parallel) and returns how many were made.
    /// Meant to run in the background; until then the original is shown.
    pub fn ensure_thumbnails(&self) -> Result<usize> {
        let ids: Vec<String> = {
            let db = self.db.lock().unwrap();
            let mut stmt = db.prepare("SELECT id FROM items ORDER BY created_at DESC")?;
            stmt.query_map([], |row| row.get(0))?
                .collect::<Result<_, _>>()?
        };
        let made = ids
            .par_iter()
            .filter(|id| {
                let dir = self.items_dir.join(id);
                !dir.join(THUMB).is_file() && write_thumbnail(&dir).is_ok()
            })
            .count();
        Ok(made)
    }

    fn dir(&self, id: Uuid) -> PathBuf {
        self.items_dir.join(id.to_string())
    }

    fn existing_dir(&self, id: Uuid) -> Result<PathBuf> {
        let dir = self.dir(id);
        if dir.is_dir() {
            Ok(dir)
        } else {
            Err(Error::ItemNotFound(id))
        }
    }
}

const SELECT_ITEMS: &str = "SELECT id, created_at, updated_at, width, height, title, favorite,
        has_annotations,
        (SELECT group_concat(tag, char(31)) FROM tags t WHERE t.item_id = items.id)
    FROM items";

/// Search words beyond this are ignored.
const MAX_SEARCH_TERMS: usize = 8;

/// The WHERE clause for a [`ListQuery`] with its positional parameters
/// (?1, ?2, … in order; callers append theirs after [`Filter::extra`]).
struct Filter {
    sql: String,
    params: Vec<Value>,
}

impl Filter {
    /// Every search word must occur in the title or the tags, in any order
    /// and as part of a word ("chnung 42" finds "Rechnung Lieferant 4242").
    fn new(query: &ListQuery) -> Self {
        let mut clauses = Vec::new();
        let mut params = Vec::new();
        if query.favorites_only {
            clauses.push("favorite = 1".to_owned());
        }
        let terms = query
            .search
            .as_deref()
            .unwrap_or_default()
            .split_whitespace();
        for term in terms.take(MAX_SEARCH_TERMS) {
            let n = params.len() + 1;
            if term.chars().count() >= 3 {
                // A quoted phrase on the trigram index matches any substring.
                clauses.push(format!(
                    "items.rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?{n})"
                ));
                params.push(Value::from(format!("\"{}\"", term.replace('"', "\"\""))));
            } else {
                // Too short for trigrams: scan the (small) full-text table.
                clauses.push(format!(
                    "items.rowid IN (SELECT rowid FROM items_fts
                                     WHERE title LIKE ?{n} ESCAPE '\\' OR tags LIKE ?{n} ESCAPE '\\')"
                ));
                params.push(Value::from(like_pattern(term)));
            }
        }
        let sql = if clauses.is_empty() {
            "1".to_owned()
        } else {
            clauses.join(" AND ")
        };
        Self { sql, params }
    }

    /// Placeholder numbers for `N` further parameters after the filter's own.
    fn extra<const N: usize>(&self) -> [usize; N] {
        std::array::from_fn(|i| self.params.len() + 1 + i)
    }

    fn params_with(&self, extra: impl IntoIterator<Item = Value>) -> Vec<Value> {
        self.params.iter().cloned().chain(extra).collect()
    }
}

fn migrate(db: &Connection) -> Result<()> {
    db.pragma_update(None, "foreign_keys", true)?;
    let version: i32 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        db.execute_batch(
            "CREATE TABLE items (
                 id              TEXT PRIMARY KEY,
                 created_at      TEXT NOT NULL,
                 updated_at      TEXT NOT NULL,
                 width           INTEGER NOT NULL,
                 height          INTEGER NOT NULL,
                 title           TEXT NOT NULL DEFAULT '',
                 favorite        INTEGER NOT NULL DEFAULT 0,
                 has_annotations INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX items_created_at ON items (created_at);
             CREATE TABLE tags (
                 item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
                 tag     TEXT NOT NULL,
                 PRIMARY KEY (item_id, tag)
             );
             CREATE INDEX tags_tag ON tags (tag);",
        )?;
    }
    if version < 2 {
        // Indexes matching the list order (also with the favorites filter)
        // and a trigram full-text index for substring search.
        db.execute_batch(
            "DROP INDEX IF EXISTS items_created_at;
             CREATE INDEX items_order ON items (created_at DESC, id DESC);
             CREATE INDEX items_favorite ON items (favorite, created_at DESC, id DESC);
             CREATE VIRTUAL TABLE items_fts USING fts5(title, tags, tokenize = 'trigram');
             CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
                 DELETE FROM items_fts WHERE rowid = old.rowid;
             END;
             INSERT INTO items_fts (rowid, title, tags)
                 SELECT rowid, title,
                        COALESCE((SELECT group_concat(tag, ' ') FROM tags WHERE item_id = items.id), '')
                 FROM items;",
        )?;
    }
    db.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

fn upsert(db: &Connection, metadata: &Metadata, has_annotations: bool) -> Result<()> {
    let id = metadata.id.to_string();
    let updated_at = metadata.updated_at.unwrap_or(metadata.created_at);
    db.execute(
        "INSERT INTO items (id, created_at, updated_at, width, height, title, favorite, has_annotations)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (id) DO UPDATE SET
             updated_at = excluded.updated_at, title = excluded.title,
             favorite = excluded.favorite, has_annotations = excluded.has_annotations",
        params![
            id,
            metadata.created_at.to_rfc3339(),
            updated_at.to_rfc3339(),
            metadata.width,
            metadata.height,
            metadata.title,
            metadata.favorite,
            has_annotations,
        ],
    )?;
    db.execute("DELETE FROM tags WHERE item_id = ?1", [&id])?;
    for tag in &metadata.tags {
        db.prepare_cached("INSERT OR IGNORE INTO tags (item_id, tag) VALUES (?1, ?2)")?
            .execute([&id, tag])?;
    }
    let rowid: i64 = db.query_row("SELECT rowid FROM items WHERE id = ?1", [&id], |r| r.get(0))?;
    db.execute("DELETE FROM items_fts WHERE rowid = ?1", [rowid])?;
    db.execute(
        "INSERT INTO items_fts (rowid, title, tags) VALUES (?1, ?2, ?3)",
        params![rowid, metadata.title, metadata.tags.join(" ")],
    )?;
    Ok(())
}

fn get(db: &Connection, items_dir: &Path, id: Uuid) -> Result<LibraryItem> {
    db.query_row(
        &format!("{SELECT_ITEMS} WHERE id = ?1"),
        [id.to_string()],
        |row| read_item(row, items_dir),
    )
    .optional()?
    .ok_or(Error::ItemNotFound(id))
}

fn read_item(row: &Row, items_dir: &Path) -> rusqlite::Result<LibraryItem> {
    let id: String = row.get(0)?;
    let dir = items_dir.join(&id);
    let has_annotations: bool = row.get(7)?;
    let tags: Option<String> = row.get(8)?;
    let mut tags: Vec<String> = tags
        .map(|t| t.split('\u{1f}').map(str::to_owned).collect())
        .unwrap_or_default();
    tags.sort_by_key(|t| t.to_lowercase());
    Ok(LibraryItem {
        id: id.parse().map_err(|e| conversion_error(0, e))?,
        created_at: parse_time(row, 1)?,
        updated_at: parse_time(row, 2)?,
        width: row.get(3)?,
        height: row.get(4)?,
        title: row.get(5)?,
        favorite: row.get(6)?,
        tags,
        has_annotations,
        thumb_path: thumb_path(&dir),
        original_path: dir.join(ORIGINAL),
        render_path: has_annotations.then(|| dir.join(RENDER)),
    })
}

/// The best available preview: thumbnail, legacy thumbnail, or the original.
fn thumb_path(dir: &Path) -> PathBuf {
    [THUMB, LEGACY_THUMB]
        .iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
        .unwrap_or_else(|| dir.join(ORIGINAL))
}

/// Writes the thumbnail of an item folder from its render (or original).
fn write_thumbnail(dir: &Path) -> Result<()> {
    let source = [RENDER, ORIGINAL]
        .iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
        .ok_or_else(|| Error::Io {
            path: dir.join(ORIGINAL),
            source: std::io::ErrorKind::NotFound.into(),
        })?;
    save_thumbnail(dir, &image::open(source)?.to_rgba8())
}

fn save_thumbnail(dir: &Path, image: &RgbaImage) -> Result<()> {
    thumbnail(image).save(dir.join(THUMB))?;
    let _ = fs::remove_file(dir.join(LEGACY_THUMB));
    Ok(())
}

fn parse_time(row: &Row, index: usize) -> rusqlite::Result<DateTime<Utc>> {
    let text: String = row.get(index)?;
    DateTime::parse_from_rfc3339(&text)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|e| conversion_error(index, e))
}

fn conversion_error(
    index: usize,
    err: impl std::error::Error + Send + Sync + 'static,
) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(err))
}

fn read_metadata(dir: &Path) -> Result<Metadata> {
    let path = dir.join(METADATA);
    let bytes = fs::read(&path).at(&path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn write_metadata(dir: &Path, metadata: &Metadata) -> Result<()> {
    let path = dir.join(METADATA);
    fs::write(&path, serde_json::to_vec_pretty(metadata)?).at(&path)
}

/// Trims, drops empty and duplicate (case-insensitive) tags.
fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let tag = tag.trim();
        if !tag.is_empty() && !out.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            out.push(tag.to_owned());
        }
    }
    out
}

/// `%text%` with LIKE wildcards in `text` escaped.
fn like_pattern(text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn thumbnail(image: &RgbaImage) -> RgbaImage {
    let (w, h) = image.dimensions();
    let scale = (THUMB_SIZE as f64 / w.max(h) as f64).min(1.0);
    let tw = ((w as f64 * scale).round() as u32).max(1);
    let th = ((h as f64 * scale).round() as u32).max(1);
    image::imageops::thumbnail(image, tw, th)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        RgbaImage::new(width, height)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .unwrap();
        bytes
    }

    #[test]
    fn add_list_get_delete() {
        let root = tempfile::tempdir().unwrap();
        let library = Library::open(root.path()).unwrap();

        let first = library.add(&RgbaImage::new(4, 3)).unwrap();
        let second = library.add(&RgbaImage::new(8, 6)).unwrap();
        assert!(first.original_path.is_file());
        assert!(first.thumb_path.is_file());
        assert!(first.render_path.is_none());

        let ids: Vec<_> = library
            .list(&ListQuery::default())
            .unwrap()
            .iter()
            .map(|i| i.id)
            .collect();
        assert_eq!(ids, [second.id, first.id]);
        assert_eq!(library.get(first.id).unwrap().width, 4);

        library.delete(first.id).unwrap();
        assert_eq!(library.list(&ListQuery::default()).unwrap().len(), 1);
        assert!(matches!(library.get(first.id), Err(Error::ItemNotFound(_))));
    }

    #[test]
    fn thumbnails_keep_aspect_ratio() {
        let thumb = thumbnail(&RgbaImage::new(1600, 400));
        assert_eq!(thumb.dimensions(), (THUMB_SIZE, THUMB_SIZE / 4));
        let small = thumbnail(&RgbaImage::new(10, 20));
        assert_eq!(small.dimensions(), (10, 20));
    }

    #[test]
    fn update_search_and_filter() {
        let root = tempfile::tempdir().unwrap();
        let library = Library::open(root.path()).unwrap();
        let a = library.add(&RgbaImage::new(1, 1)).unwrap();
        let b = library.add(&RgbaImage::new(1, 1)).unwrap();

        let a = library
            .update(
                a.id,
                ItemUpdate {
                    title: Some("  Login dialog ".into()),
                    tags: Some(vec!["Bug".into(), " bug".into(), "".into(), "UI".into()]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(a.title, "Login dialog");
        assert_eq!(a.tags, ["Bug", "UI"]);
        library
            .update(
                b.id,
                ItemUpdate {
                    favorite: Some(true),
                    title: Some("100% done_".into()),
                    ..Default::default()
                },
            )
            .unwrap();

        let search = |text: &str| -> Vec<Uuid> {
            let query = ListQuery {
                search: Some(text.into()),
                ..Default::default()
            };
            library.list(&query).unwrap().iter().map(|i| i.id).collect()
        };
        assert_eq!(search("login"), [a.id]);
        assert_eq!(search("ui"), [a.id]);
        assert_eq!(search("%"), [b.id]);
        assert_eq!(search("_"), [b.id]);
        assert_eq!(search("nothing"), Vec::<Uuid>::new());

        let favorites = library
            .list(&ListQuery {
                favorites_only: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(favorites.len(), 1);
        assert_eq!(favorites[0].id, b.id);
        assert_eq!(library.tags().unwrap(), ["Bug", "UI"]);
    }

    #[test]
    fn document_and_render() {
        let root = tempfile::tempdir().unwrap();
        let library = Library::open(root.path()).unwrap();
        let item = library.add(&RgbaImage::new(20, 10)).unwrap();

        assert!(library.load_document(item.id).unwrap().is_none());
        assert!(matches!(
            library.save_document(item.id, &serde_json::json!({ "objects": [] })),
            Err(Error::InvalidDocument(_))
        ));
        let document = serde_json::json!({ "schemaVersion": 1, "objects": [] });
        library.save_document(item.id, &document).unwrap();
        assert_eq!(library.load_document(item.id).unwrap(), Some(document));

        assert!(library.save_render(item.id, b"not a png").is_err());
        let edited = library.save_render(item.id, &png(10, 5)).unwrap();
        assert!(edited.has_annotations);
        assert_eq!(
            library.output_path(item.id).unwrap(),
            edited.render_path.unwrap()
        );
    }

    #[test]
    fn assets() {
        let root = tempfile::tempdir().unwrap();
        let library = Library::open(root.path()).unwrap();
        let item = library.add(&RgbaImage::new(2, 2)).unwrap();

        assert!(library.save_asset(item.id, b"not a png").is_err());
        let name = library.save_asset(item.id, &png(3, 3)).unwrap();
        assert_eq!(library.read_asset(item.id, &name).unwrap(), png(3, 3));

        for bad in [
            "../item.json",
            "x.png",
            "original.png",
            &name.replace(".png", ""),
        ] {
            assert!(matches!(
                library.read_asset(item.id, bad),
                Err(Error::InvalidAsset(_))
            ));
        }
    }

    #[test]
    fn pages_count_and_position() {
        let root = tempfile::tempdir().unwrap();
        let library = Library::open(root.path()).unwrap();
        let ids: Vec<Uuid> = (0..7)
            .map(|_| library.add(&RgbaImage::new(1, 1)).unwrap().id)
            .collect();
        let newest_first: Vec<Uuid> = ids.iter().rev().copied().collect();
        let all = ListQuery::default();

        assert_eq!(library.count(&all).unwrap(), 7);
        let page = |offset, limit| -> Vec<Uuid> {
            library
                .list_page(&all, offset, limit)
                .unwrap()
                .iter()
                .map(|i| i.id)
                .collect()
        };
        assert_eq!(page(0, 3), newest_first[0..3]);
        assert_eq!(page(3, 3), newest_first[3..6]);
        assert_eq!(page(6, 3), newest_first[6..]);
        assert!(page(9, 3).is_empty());

        assert_eq!(library.position(ids[6], &all).unwrap(), Some(0));
        assert_eq!(library.position(ids[0], &all).unwrap(), Some(6));
        let favorites = ListQuery {
            favorites_only: true,
            ..Default::default()
        };
        assert_eq!(library.position(ids[0], &favorites).unwrap(), None);
        assert_eq!(library.count(&favorites).unwrap(), 0);
    }

    #[test]
    fn search_finds_substrings_and_follows_updates() {
        let root = tempfile::tempdir().unwrap();
        let library = Library::open(root.path()).unwrap();
        let item = library.add(&RgbaImage::new(1, 1)).unwrap();
        let search = |text: &str| {
            library
                .count(&ListQuery {
                    search: Some(text.into()),
                    ..Default::default()
                })
                .unwrap()
        };
        library
            .update(
                item.id,
                ItemUpdate {
                    title: Some("Rechnung Lieferant".into()),
                    tags: Some(vec!["Buchhaltung".into()]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(search("chnung"), 1);
        assert_eq!(search("LIEFER"), 1);
        assert_eq!(search("haltung"), 1);
        assert_eq!(search("re"), 1);
        assert_eq!(search("nichts"), 0);
        // Every word must match, in any order, title or tags.
        assert_eq!(search("liefer chnung"), 1);
        assert_eq!(search("chnung buchhalt"), 1);
        assert_eq!(search("chnung angebot"), 0);
        assert_eq!(search("\"chnung"), 0);

        library
            .update(
                item.id,
                ItemUpdate {
                    title: Some("Angebot".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(search("chnung"), 0);
        library.delete(item.id).unwrap();
        assert_eq!(search("gebot"), 0);
    }

    #[test]
    fn reindex_imports_and_prunes_folders() {
        let root = tempfile::tempdir().unwrap();
        let (kept, removed) = {
            let library = Library::open(root.path()).unwrap();
            let kept = library.add(&RgbaImage::new(1, 1)).unwrap();
            let removed = library.add(&RgbaImage::new(1, 1)).unwrap();
            library
                .update(
                    kept.id,
                    ItemUpdate {
                        tags: Some(vec!["keep".into()]),
                        ..Default::default()
                    },
                )
                .unwrap();
            (kept.id, removed.id)
        };

        // Lose the index and one folder; add a folder that is not an item.
        fs::remove_file(root.path().join(DATABASE)).unwrap();
        fs::remove_dir_all(root.path().join("items").join(removed.to_string())).unwrap();
        fs::create_dir_all(root.path().join("items").join("garbage")).unwrap();

        let library = Library::open(root.path()).unwrap();
        let items = library.list(&ListQuery::default()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, kept);
        assert_eq!(items[0].tags, ["keep"]);
    }

    #[test]
    fn phase0_items_are_imported() {
        // Phase 0 wrote item.json without title/tags and without thumbnails.
        let root = tempfile::tempdir().unwrap();
        let id = Uuid::now_v7();
        let dir = root.path().join("items").join(id.to_string());
        fs::create_dir_all(&dir).unwrap();
        RgbaImage::new(3, 2).save(dir.join(ORIGINAL)).unwrap();
        fs::write(
            dir.join(METADATA),
            format!(
                r#"{{"id":"{id}","createdAt":"2026-10-22T11:36:37Z","width":3,"height":2,"originalPath":"x"}}"#
            ),
        )
        .unwrap();

        let library = Library::open(root.path()).unwrap();
        let item = library.get(id).unwrap();
        assert_eq!(item.updated_at, item.created_at);
        // Until thumbnails are made in the background, the original is the preview.
        assert_eq!(item.thumb_path, item.original_path);
        assert_eq!(library.ensure_thumbnails().unwrap(), 1);
        let item = library.get(id).unwrap();
        assert!(item.thumb_path.ends_with("thumb.webp") && item.thumb_path.is_file());
        assert_eq!(library.ensure_thumbnails().unwrap(), 0);
    }
}
