//! Tauri commands, i.e. the IPC surface used by the web UI.
//!
//! Commands stay thin: the actual work happens in `zwopp-core` (or in
//! `capture` for the window handling) so a CLI or HTTP API can reuse it later.

use std::path::PathBuf;

use std::time::Duration;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use zwopp_core::capture::DesktopRect;
use zwopp_core::export::{self, ExportFormat};
use zwopp_core::library::{ItemUpdate, Library, LibraryItem, ListQuery, Overview};
use zwopp_core::settings::Settings;

use crate::{AppState, capture, main_window, recording, report, settings, tray, update};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Runs library work on the blocking thread pool, so slow disk or image work
/// never ties up the IPC workers that keep the UI responsive.
async fn blocking<T: Send + 'static>(
    state: &AppState,
    work: impl FnOnce(&Library) -> zwopp_core::Result<T> + Send + 'static,
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

/// Starts a panorama or GIF recording of `rect` (desktop pixels) chosen in
/// the capture overlay. Async: it creates windows.
#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    rect: DesktopRect,
    mode: recording::Mode,
) -> CmdResult<()> {
    recording::start(&app, rect, mode).await
}

/// What a problem report would contain (shown before anything is opened).
#[tauri::command]
pub fn report_info(app: AppHandle) -> report::ReportInfo {
    report::info(&app)
}

/// Opens a prefilled issue form of Zwopp on GitHub in the browser.
#[tauri::command]
pub fn open_issue(app: AppHandle, url: String) -> CmdResult<()> {
    report::open_issue(&app, &url)
}

#[tauri::command]
pub fn open_log_folder(app: AppHandle) -> CmdResult<()> {
    report::open_log_folder(&app)
}

/// The update on offer, if the last check found one; `enabled` is false for
/// a development build, which does not look for updates.
#[derive(Serialize)]
pub struct UpdateStatus {
    enabled: bool,
    available: Option<update::Available>,
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateStatus {
    UpdateStatus {
        enabled: update::enabled(),
        available: update::available(&app),
    }
}

/// Looks for an update now (Settings › Updates).
#[tauri::command]
pub async fn check_update(app: AppHandle) -> CmdResult<Option<update::Available>> {
    update::check(&app).await
}

/// Downloads and installs the update, then restarts Zwopp; only on request.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> CmdResult<()> {
    update::install(&app).await
}

/// Ends the recording and saves it to the library.
#[tauri::command]
pub fn stop_recording(app: AppHandle) {
    recording::stop(&app);
}

#[tauri::command]
pub fn cancel_recording(app: AppHandle) {
    recording::cancel(&app);
}

/// The registered capture hotkey (e.g. `CommandOrControl+Shift+X`), if any.
#[tauri::command]
pub fn capture_shortcut(state: State<'_, AppState>) -> Option<String> {
    state.capture_shortcut.lock().unwrap().clone()
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> CmdResult<settings::SettingsInfo> {
    settings::info(&app).map_err(err)
}

/// Applies and stores the settings. Fails, keeping the old hotkey, if the new
/// one is taken.
#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    settings: Settings,
) -> CmdResult<settings::SettingsInfo> {
    settings::save(&app, settings)
}

/// Asks for a folder, starting in `start`; `None` if cancelled.
#[tauri::command]
pub async fn pick_folder(
    app: AppHandle,
    title: String,
    start: Option<PathBuf>,
) -> CmdResult<Option<PathBuf>> {
    let mut dialog = app.dialog().file().set_title(title);
    if let Some(start) = start {
        dialog = dialog.set_directory(start);
    }
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(err)?;
    Ok(chosen.and_then(|p| p.into_path().ok()))
}

/// Asks where to save a JSON file named `name` and writes `contents` there.
/// Returns the path, or `None` if cancelled.
#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    title: String,
    name: String,
    contents: String,
) -> CmdResult<Option<String>> {
    let dialog = app
        .dialog()
        .file()
        .set_title(title)
        .set_file_name(name)
        .add_filter("JSON", &["json"]);
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(err)?;
    let Some(path) = chosen.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    std::fs::write(&path, contents).map_err(err)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Asks for a JSON file and returns its contents, or `None` if cancelled.
#[tauri::command]
pub async fn open_text_file(app: AppHandle, title: String) -> CmdResult<Option<String>> {
    let dialog = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter("JSON", &["json"]);
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(err)?;
    let Some(path) = chosen.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    std::fs::read_to_string(path).map(Some).map_err(err)
}

/// Restarts the app, e.g. to open another library folder.
#[tauri::command]
pub fn restart(app: AppHandle) {
    app.restart();
}

/// The view the main window should switch to, if one waits (see `main_window`).
#[tauri::command]
pub fn take_view(app: AppHandle) -> Option<main_window::View> {
    main_window::take_view(&app)
}

/// Whether Zwopp starts at login; `None` for a development build, which
/// never registers itself (only the installed app should start).
#[tauri::command]
pub fn autostart(app: AppHandle) -> CmdResult<Option<bool>> {
    if tauri::is_dev() {
        return Ok(None);
    }
    app.autolaunch().is_enabled().map(Some).map_err(err)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> CmdResult<()> {
    if tauri::is_dev() {
        return Err("a development build does not start at login".into());
    }
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    }
    .map_err(err)
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

/// Counts per month and application for the library's navigation.
#[tauri::command]
pub async fn library_overview(
    state: State<'_, AppState>,
    recent_since: chrono::DateTime<chrono::Utc>,
) -> CmdResult<Overview> {
    blocking(&state, move |library| library.overview(recent_since)).await
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

/// Copies the item (with annotations, if any) to the clipboard; a GIF as a
/// file, so it stays animated where it is pasted.
#[tauri::command]
pub async fn copy_item(app: AppHandle, state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    if state.library.get(id).map_err(err)?.animation_path.is_some() {
        return tauri::async_runtime::spawn_blocking(move || capture::copy_file(&app, id))
            .await
            .map_err(err)?;
    }
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
    let natural = ExportFormat::of(&item);
    let mut dialog = app.dialog().file().set_title(title).set_file_name(format!(
        "{}.{}",
        export::file_stem(&item),
        natural.extension()
    ));
    if natural == ExportFormat::Gif {
        dialog = dialog.add_filter("GIF", &["gif"]);
    }
    dialog = dialog
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
            name.push(".");
            name.push(natural.extension());
            (PathBuf::from(name), natural)
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

/// Writes item `id` as a PNG (a recording as GIF) named after its title into
/// a scratch folder, so dragging it out hands other apps a copy, never the
/// library's file.
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
        let format = ExportFormat::of(&library.get(id)?);
        Ok(DragFile {
            file: export::export_into(library, id, &dir, format)?,
            icon: library.preview_path(id)?,
        })
    })
    .await
}
