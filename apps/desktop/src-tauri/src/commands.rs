//! Tauri commands, i.e. the IPC surface used by the web UI.
//!
//! Commands stay thin: the actual work happens in `screenbook-core` (or in
//! `capture` for the window handling) so a CLI or HTTP API can reuse it later.

use screenbook_core::capture::Rect;
use screenbook_core::library::LibraryItem;
use tauri::ipc::Response;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{AppState, capture};

type CmdResult<T> = Result<T, String>;

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

#[tauri::command]
pub async fn list_items(state: State<'_, AppState>) -> CmdResult<Vec<LibraryItem>> {
    state.library.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_item(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    state.library.delete(id).map_err(|e| e.to_string())
}
