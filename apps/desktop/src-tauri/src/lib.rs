mod capture;
mod commands;
mod platform;
mod settings;
mod thumbs;
mod tray;

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;
use zwopp_core::library::Library;
use zwopp_core::settings::Settings;

pub struct AppState {
    pub library: Arc<Library>,
    pub session: Mutex<Option<capture::Session>>,
    pub settings: Mutex<Settings>,
    /// The registered capture hotkey, if any could be registered.
    pub capture_shortcut: Mutex<Option<String>>,
    /// Folder of the last export, offered again by the next one.
    pub export_dir: Mutex<Option<std::path::PathBuf>>,
}

/// Syncs the index with the item folders and creates missing thumbnails,
/// off the main thread so even a huge library opens instantly. The UI
/// refreshes on the `library:indexed` / `library:thumbnails` events.
fn maintain_library(app: AppHandle, library: Arc<Library>) {
    std::thread::spawn(move || {
        match library.reindex() {
            Ok(()) => drop(app.emit("library:indexed", ())),
            Err(err) => eprintln!("reindex failed: {err}"),
        }
        match library.ensure_thumbnails() {
            Ok(0) => {}
            Ok(_) => drop(app.emit("library:thumbnails", ())),
            Err(err) => eprintln!("thumbnails failed: {err}"),
        }
    });
}

/// Brings the main (library) window to the front.
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(thumbs::SCHEME, thumbs::handle)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(
            // Only the capture hotkey is ever registered.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        capture::start_in_background(app.clone(), std::time::Duration::ZERO);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let settings = settings::load(app.handle())?;
            // ZWOPP_LIBRARY_DIR points the app at another library, e.g. a
            // generated one for performance tests (see README); it wins over
            // the folder from the settings.
            let custom = std::env::var_os("ZWOPP_LIBRARY_DIR")
                .map(std::path::PathBuf::from)
                .or_else(|| settings.library_dir.clone());
            let root = match custom {
                Some(dir) => {
                    // The asset protocol only serves the default folder by itself.
                    app.asset_protocol_scope().allow_directory(&dir, true)?;
                    dir
                }
                None => settings::default_library_dir(app.handle())?,
            };
            let capture_shortcut = settings::register_capture_shortcut(
                app.handle(),
                settings.capture_hotkey.as_deref(),
            );
            let library = Arc::new(Library::open_index(root)?);
            maintain_library(app.handle().clone(), library.clone());
            if let Some(main) = app.get_webview_window("main") {
                platform::disable_hide_animation(&main);
            }
            tray::create(app.handle(), capture_shortcut.as_deref())?;
            app.manage(AppState {
                library,
                session: Mutex::default(),
                settings: Mutex::new(settings),
                capture_shortcut: Mutex::new(capture_shortcut),
                export_dir: Mutex::default(),
            });
            // Loaded now, so the first capture does not wait for webviews to start.
            let monitors = app.available_monitors()?;
            if let Err(e) = capture::prepare_overlays(app.handle(), &monitors) {
                eprintln!("could not prepare the capture overlays: {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the library only hides it; the app keeps running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_capture,
            commands::capture_layout,
            commands::overlay_frame,
            commands::finish_capture,
            commands::cancel_capture,
            commands::capture_shortcut,
            commands::set_language,
            commands::get_settings,
            commands::save_settings,
            commands::pick_folder,
            commands::save_text_file,
            commands::open_text_file,
            commands::restart,
            commands::list_items,
            commands::count_items,
            commands::item_position,
            commands::library_overview,
            commands::list_tags,
            commands::update_item,
            commands::delete_item,
            commands::read_original,
            commands::load_document,
            commands::save_document,
            commands::save_render,
            commands::save_asset,
            commands::read_asset,
            commands::copy_item,
            commands::export_item,
            commands::drag_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
