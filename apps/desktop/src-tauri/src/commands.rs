//! Tauri commands, i.e. the IPC surface used by the web UI.
//!
//! Commands stay thin: the actual work happens in `screenbook-core` (or in
//! `capture` for the window handling) so a CLI or HTTP API can reuse it later.

use std::path::PathBuf;

use std::time::Duration;

use screenbook_core::capture::DesktopRect;
use screenbook_core::export::{self, ExportFormat};
use screenbook_core::library::{ItemUpdate, Library, LibraryItem, ListQuery};
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::{AppState, capture, tray};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Runs library work on the blocking thread pool, so slow disk or image work
/// never ties up the IPC workers that keep the UI responsive.
async fn blocking<T: Send + 'static>(
    state: &AppState,
    work: impl FnOnce(&Library) -> screenbook_core::Result<T> + Send + 'static,
) -> CmdResult<T> {
    let library = state.library.clone();
    tauri::async_runtime::spawn_blocking(move || work(&library))
        .await
        .map_err(err)?
        .map_err(err)
}

/// Starts a capture, after `delay` seconds if given (to open a menu first).
#[tauri::command]
pub async fn start_capture(app: AppHandle, delay: Option<u64>) -> CmdResult<()> {
    let delay = Duration::from_secs(delay.unwrap_or(0));
    capture::start(&app, delay)
        .await
        .inspect_err(|_| capture::finish(&app))
}

/// Monitors and windows of the running capture, in desktop pixels.
#[tauri::command]
pub async fn capture_layout(app: AppHandle) -> CmdResult<capture::Layout> {
    capture::layout(&app)
}

/// The frozen frame for overlay `index`, as PNG bytes (encoded at the freeze).
#[tauri::command]
pub async fn overlay_frame(state: State<'_, AppState>, index: usize) -> CmdResult<Response> {
    let png = state
        .session
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|session| session.previews.get(index).cloned())
        .ok_or("no capture in progress")?;
    Ok(Response::new(png.as_ref().clone()))
}

/// Saves the selected region; `rect` is in desktop pixels and may span monitors.
#[tauri::command]
pub async fn finish_capture(app: AppHandle, rect: DesktopRect) -> CmdResult<LibraryItem> {
    capture::complete(&app, rect)
}

#[tauri::command]
pub async fn cancel_capture(app: AppHandle) {
    capture::finish(&app);
}

/// The registered capture hotkey (e.g. `CommandOrControl+Shift+X`), if any.
#[tauri::command]
pub fn capture_shortcut(state: State<'_, AppState>) -> Option<&'static str> {
    state.capture_shortcut
}

/// The UI language ("de", "en") as the web UI picked it, for the tray menu.
/// Async, so it does not run on the main thread, which menu changes wait for.
#[tauri::command]
pub async fn set_language(menu: State<'_, tray::TrayMenu>, language: String) -> CmdResult<()> {
    tray::set_language(&menu, &language).map_err(err)
}

/// One page of the library list (see `Library::list_page`).
#[tauri::command]
pub async fn list_items(
    state: State<'_, AppState>,
    query: ListQuery,
    offset: u64,
    limit: u32,
) -> CmdResult<Vec<LibraryItem>> {
    blocking(&state, move |library| {
        library.list_page(&query, offset, limit)
    })
    .await
}

#[tauri::command]
pub async fn count_items(state: State<'_, AppState>, query: ListQuery) -> CmdResult<u64> {
    blocking(&state, move |library| library.count(&query)).await
}

/// Index of an item in the list for `query`, e.g. to scroll the filmstrip to it.
#[tauri::command]
pub async fn item_position(
    state: State<'_, AppState>,
    id: Uuid,
    query: ListQuery,
) -> CmdResult<Option<u64>> {
    blocking(&state, move |library| library.position(id, &query)).await
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    blocking(&state, |library| library.tags()).await
}

#[tauri::command]
pub async fn update_item(
    state: State<'_, AppState>,
    id: Uuid,
    update: ItemUpdate,
) -> CmdResult<LibraryItem> {
    blocking(&state, move |library| library.update(id, update)).await
}

#[tauri::command]
pub async fn delete_item(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    blocking(&state, move |library| library.delete(id)).await
}

/// The untouched original as PNG bytes. The editor loads it this way (not via
/// the asset protocol) so its canvas stays same-origin and can be exported.
#[tauri::command]
pub async fn read_original(state: State<'_, AppState>, id: Uuid) -> CmdResult<Response> {
    let path = blocking(&state, move |library| Ok(library.get(id)?.original_path)).await?;
    tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(err)?
        .map(Response::new)
        .map_err(err)
}

#[tauri::command]
pub async fn load_document(
    state: State<'_, AppState>,
    id: Uuid,
) -> CmdResult<Option<serde_json::Value>> {
    blocking(&state, move |library| library.load_document(id)).await
}

#[tauri::command]
pub async fn save_document(
    state: State<'_, AppState>,
    id: Uuid,
    document: serde_json::Value,
) -> CmdResult<()> {
    blocking(&state, move |library| library.save_document(id, &document)).await
}

/// Stores the rendered PNG. The bytes are sent as the raw request body and the
/// item id as the `item-id` header, which avoids JSON-encoding large images.
#[tauri::command]
pub async fn save_render(
    state: State<'_, AppState>,
    request: Request<'_>,
) -> CmdResult<LibraryItem> {
    let (id, png) = raw_png(&request)?;
    let png = png.to_vec();
    blocking(&state, move |library| library.save_render(id, &png)).await
}

/// Splits a raw-body request into the `item-id` header and the PNG bytes.
fn raw_png<'a>(request: &'a Request<'_>) -> CmdResult<(Uuid, &'a [u8])> {
    let InvokeBody::Raw(png) = request.body() else {
        return Err("expected raw PNG body".into());
    };
    let id = request
        .headers()
        .get("item-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("missing item-id header")?;
    Ok((id, png))
}

/// Stores an extra image for the item's document; raw PNG body, `item-id` header.
#[tauri::command]
pub async fn save_asset(state: State<'_, AppState>, request: Request<'_>) -> CmdResult<String> {
    let (id, png) = raw_png(&request)?;
    let png = png.to_vec();
    blocking(&state, move |library| library.save_asset(id, &png)).await
}

#[tauri::command]
pub async fn read_asset(state: State<'_, AppState>, id: Uuid, name: String) -> CmdResult<Response> {
    blocking(&state, move |library| library.read_asset(id, &name))
        .await
        .map(Response::new)
}

/// Copies the item (with annotations, if any) to the clipboard.
#[tauri::command]
pub async fn copy_item(app: AppHandle, state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    let image = blocking(&state, move |library| {
        Ok(image::open(library.output_path(id)?)?.to_rgba8())
    })
    .await?;
    let clip = tauri::image::Image::new(image.as_raw(), image.width(), image.height());
    app.clipboard().write_image(&clip).map_err(err)
}

/// Asks where to save item `id` (dialog titled `title`) and writes it there
/// as PNG, JPEG or WebP, by the chosen file extension. Returns the path, or
/// `None` if the dialog was cancelled.
#[tauri::command]
pub async fn export_item(
    app: AppHandle,
    state: State<'_, AppState>,
    id: Uuid,
    title: String,
) -> CmdResult<Option<String>> {
    let library = state.library.clone();
    let item = library.get(id).map_err(err)?;
    let folder = state
        .export_dir
        .lock()
        .unwrap()
        .clone()
        .or_else(|| app.path().picture_dir().ok());
    let mut dialog = app
        .dialog()
        .file()
        .set_title(title)
        .set_file_name(format!("{}.png", export::file_stem(&item)))
        .add_filter("PNG", &["png"])
        .add_filter("JPEG", &["jpg", "jpeg"])
        .add_filter("WebP", &["webp"]);
    if let Some(folder) = folder {
        dialog = dialog.set_directory(folder);
    }
    // The dialog blocks until closed, so it must not hold an IPC worker.
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(err)?;
    let Some(path) = chosen.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let (path, format) = match ExportFormat::from_path(&path) {
        Some(format) => (path, format),
        None => {
            let mut name = path.into_os_string();
            name.push(".png");
            (PathBuf::from(name), ExportFormat::Png)
        }
    };
    *state.export_dir.lock().unwrap() = path.parent().map(PathBuf::from);
    let written = path.clone();
    blocking(&state, move |library| {
        export::export(library, id, &written, format)
    })
    .await?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// A file to drag into another app and the image shown while dragging.
#[derive(Serialize)]
pub struct DragFile {
    file: PathBuf,
    icon: PathBuf,
}

/// Writes item `id` as a PNG named after its title into a scratch folder,
/// so dragging it out hands other apps a copy, never the library's file.
#[tauri::command]
pub async fn drag_file(
    app: AppHandle,
    state: State<'_, AppState>,
    id: Uuid,
) -> CmdResult<DragFile> {
    let dir = app.path().app_cache_dir().map_err(err)?.join("drag");
    blocking(&state, move |library| {
        // Only the latest drag is needed; older copies would pile up.
        let _ = std::fs::remove_dir_all(&dir);
        Ok(DragFile {
            file: export::export_into(library, id, &dir, ExportFormat::Png)?,
            icon: library.preview_path(id)?,
        })
    })
    .await
}
