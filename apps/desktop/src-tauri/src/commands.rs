//! Tauri commands, i.e. the IPC surface used by the web UI.
//!
//! Commands stay thin: the actual work happens in `screenbook-core` (or in
//! `capture` for the window handling) so a CLI or HTTP API can reuse it later.

use screenbook_core::capture::Rect;
use screenbook_core::library::{ItemUpdate, LibraryItem, ListQuery};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use uuid::Uuid;

use crate::{AppState, capture};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
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

#[tauri::command]
pub async fn list_items(
    state: State<'_, AppState>,
    query: ListQuery,
) -> CmdResult<Vec<LibraryItem>> {
    state.library.list(&query).map_err(err)
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    state.library.tags().map_err(err)
}

#[tauri::command]
pub async fn update_item(
    state: State<'_, AppState>,
    id: Uuid,
    update: ItemUpdate,
) -> CmdResult<LibraryItem> {
    state.library.update(id, update).map_err(err)
}

#[tauri::command]
pub async fn delete_item(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    state.library.delete(id).map_err(err)
}

/// The untouched original as PNG bytes. The editor loads it this way (not via
/// the asset protocol) so its canvas stays same-origin and can be exported.
#[tauri::command]
pub async fn read_original(state: State<'_, AppState>, id: Uuid) -> CmdResult<Response> {
    let path = state.library.get(id).map_err(err)?.original_path;
    std::fs::read(path).map(Response::new).map_err(err)
}

#[tauri::command]
pub async fn load_document(
    state: State<'_, AppState>,
    id: Uuid,
) -> CmdResult<Option<serde_json::Value>> {
    state.library.load_document(id).map_err(err)
}

#[tauri::command]
pub async fn save_document(
    state: State<'_, AppState>,
    id: Uuid,
    document: serde_json::Value,
) -> CmdResult<()> {
    state.library.save_document(id, &document).map_err(err)
}

/// Stores the rendered PNG. The bytes are sent as the raw request body and the
/// item id as the `item-id` header, which avoids JSON-encoding large images.
#[tauri::command]
pub async fn save_render(
    state: State<'_, AppState>,
    request: Request<'_>,
) -> CmdResult<LibraryItem> {
    let (id, png) = raw_png(&request)?;
    state.library.save_render(id, png).map_err(err)
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
    state.library.save_asset(id, png).map_err(err)
}

#[tauri::command]
pub async fn read_asset(state: State<'_, AppState>, id: Uuid, name: String) -> CmdResult<Response> {
    state
        .library
        .read_asset(id, &name)
        .map(Response::new)
        .map_err(err)
}

/// Copies the item (with annotations, if any) to the clipboard.
#[tauri::command]
pub async fn copy_item(app: AppHandle, state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    let path = state.library.output_path(id).map_err(err)?;
    let image = image::open(path).map_err(err)?.to_rgba8();
    let clip = tauri::image::Image::new(image.as_raw(), image.width(), image.height());
    app.clipboard().write_image(&clip).map_err(err)
}
