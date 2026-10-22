//! Tauri commands, i.e. the IPC surface used by the web UI.
//!
//! Commands stay thin: the actual work happens in `screenbook-core` (or in
//! `capture` for the window handling) so a CLI or HTTP API can reuse it later.

use screenbook_core::capture::Rect;
use screenbook_core::library::{ItemUpdate, Library, LibraryItem, ListQuery};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use uuid::Uuid;

use crate::{AppState, capture};

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

#[tauri::command]
pub async fn start_capture(app: AppHandle) -> CmdResult<()> {
    capture::start(&app).inspect_err(|_| capture::finish(&app))
}

/// The frozen frame for overlay `index`, as PNG bytes.
#[tauri::command]
pub async fn overlay_frame(state: State<'_, AppState>, index: usize) -> CmdResult<Response> {
    let frame = state
        .session
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|session| session.frames.get(index).cloned())
        .ok_or("no capture in progress")?;
    Ok(Response::new(capture::preview_png(&frame)?))
}

#[tauri::command]
pub async fn finish_capture(app: AppHandle, index: usize, rect: Rect) -> CmdResult<LibraryItem> {
    capture::complete(&app, index, rect)
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
