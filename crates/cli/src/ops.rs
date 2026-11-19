//! What the commands do.

use std::path::{Path, PathBuf};

use serde::Serialize;
use uuid::Uuid;
use zwopp_core::capture::{self, DesktopRect, WindowEntry};
use zwopp_core::export::{self, ExportFormat};
use zwopp_core::library::{ItemUpdate, Library, LibraryItem, ListQuery};

/// What to capture.
#[derive(Debug, Clone)]
pub enum Target {
    /// A monitor by index, or the primary one.
    Screen(Option<usize>),
    /// The topmost window whose title or application contains this text.
    Window(String),
    /// The window with the keyboard focus.
    Focused,
    /// A rectangle in desktop pixels, also across monitors.
    Region(DesktopRect),
}

/// An item as the command line shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: Uuid,
    pub title: String,
    pub created_at: String,
    pub app: Option<String>,
    pub width: u32,
    pub height: u32,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub annotated: bool,
    /// A GIF recording rather than a still image.
    pub animated: bool,
    /// The image file: annotated if edited, the GIF for a recording.
    pub file: PathBuf,
}

impl From<LibraryItem> for Item {
    fn from(item: LibraryItem) -> Self {
        let file = item
            .animation_path
            .clone()
            .or_else(|| item.render_path.clone())
            .unwrap_or_else(|| item.original_path.clone());
        Self {
            id: item.id,
            title: item.title,
            created_at: item.created_at.to_rfc3339(),
            app: item.app,
            width: item.width,
            height: item.height,
            tags: item.tags,
            favorite: item.favorite,
            annotated: item.has_annotations,
            animated: item.animation_path.is_some(),
            file,
        }
    }
}

/// Captures `target` without the overlay and saves it to the library.
pub fn capture(
    library: &Library,
    target: &Target,
    title: Option<String>,
    tags: Vec<String>,
) -> Result<Item, String> {
    let (image, app) = match target {
        Target::Screen(index) => {
            let index = match index {
                Some(index) => *index,
                None => capture::monitors()
                    .map_err(err)?
                    .iter()
                    .position(|m| m.is_primary)
                    .unwrap_or(0),
            };
            (capture::capture_monitor(index).map_err(err)?, None)
        }
        Target::Window(query) => {
            let window = find_window(query)?;
            (capture::capture_window(window.id).map_err(err)?, window.app)
        }
        Target::Focused => {
            let window = capture::list_windows()
                .map_err(err)?
                .into_iter()
                .find(|w| w.focused)
                .ok_or("no window has the focus")?;
            (capture::capture_window(window.id).map_err(err)?, window.app)
        }
        Target::Region(rect) => (capture::capture_rect(*rect).map_err(err)?, None),
    };
    let mut item = library.add_from(&image, app.as_deref()).map_err(err)?;
    if title.is_some() || !tags.is_empty() {
        item = library
            .update(
                item.id,
                ItemUpdate {
                    title,
                    tags: (!tags.is_empty()).then_some(tags),
                    favorite: None,
                },
            )
            .map_err(err)?;
    }
    Ok(item.into())
}

/// The topmost window whose title or application contains `query` (any case).
pub fn find_window(query: &str) -> Result<WindowEntry, String> {
    let query = query.to_lowercase();
    capture::list_windows()
        .map_err(err)?
        .into_iter()
        .find(|w| {
            w.title.to_lowercase().contains(&query)
                || w.app
                    .as_ref()
                    .is_some_and(|a| a.to_lowercase().contains(&query))
        })
        .ok_or_else(|| format!("no window matches \"{query}\" (see `zwopp windows`)"))
}

pub fn list(library: &Library, query: &ListQuery, limit: u32) -> Result<Vec<Item>, String> {
    Ok(library
        .list_page(query, 0, limit)
        .map_err(err)?
        .into_iter()
        .map(Item::from)
        .collect())
}

pub fn get(library: &Library, id: &str) -> Result<Item, String> {
    Ok(library.get(parse_id(id)?).map_err(err)?.into())
}

/// Writes item `id` to `path`, in the format its extension names (PNG if none).
pub fn export(library: &Library, id: &str, path: &Path) -> Result<PathBuf, String> {
    let id = parse_id(id)?;
    let (path, format) = match ExportFormat::from_path(path) {
        Some(format) => (path.to_path_buf(), format),
        None => (path.with_extension("png"), ExportFormat::Png),
    };
    export::export(library, id, &path, format).map_err(err)?;
    Ok(path)
}

/// Exports the whole library into a new folder in `parent` (ADR 0013).
pub fn export_library(
    library: &Library,
    parent: &Path,
    progress: impl FnMut(usize, usize),
) -> Result<zwopp_core::archive::LibraryExport, String> {
    std::fs::create_dir_all(parent).map_err(err)?;
    zwopp_core::archive::export_library(
        library,
        parent,
        concat!("Zwopp ", env!("CARGO_PKG_VERSION")),
        progress,
    )
    .map_err(err)
}

fn parse_id(id: &str) -> Result<Uuid, String> {
    id.trim()
        .parse()
        .map_err(|_| format!("\"{id}\" is not a screenshot id (see `zwopp list`)"))
}

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
