mod capture;
mod commands;
mod platform;
mod tray;

use std::sync::{Arc, Mutex};

use screenbook_core::library::Library;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Global hotkeys that start a region capture, in order of preference. Another
/// app may own one already, so the first free one is used.
const CAPTURE_SHORTCUTS: &[&str] = &[
    "CommandOrControl+Shift+X",
    "CommandOrControl+Alt+X",
    "CommandOrControl+Shift+2",
];

pub struct AppState {
    pub library: Arc<Library>,
    pub session: Mutex<Option<capture::Session>>,
    /// The registered capture hotkey, if any could be registered.
    pub capture_shortcut: Option<&'static str>,
}

fn register_capture_shortcut(app: &AppHandle) -> Option<&'static str> {
    CAPTURE_SHORTCUTS.iter().copied().find(|accelerator| {
        let Ok(shortcut) = accelerator.parse::<Shortcut>() else {
            return false;
        };
        match app.global_shortcut().register(shortcut) {
            Ok(()) => true,
            Err(err) => {
                eprintln!("could not register {accelerator}: {err}");
                false
            }
        }
    })
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            // Only the capture hotkey is ever registered.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        capture::start_in_background(app.clone());
                    }
                })
                .build(),
        )
        .setup(|app| {
            // SCREENBOOK_LIBRARY_DIR points the app at another library, e.g. a
            // generated one for performance tests (see README).
            let root = match std::env::var_os("SCREENBOOK_LIBRARY_DIR") {
                Some(dir) => {
                    let dir = std::path::PathBuf::from(dir);
                    app.asset_protocol_scope().allow_directory(&dir, true)?;
                    dir
                }
                None => app.path().app_data_dir()?.join("library"),
            };
            // Without a hotkey the tray menu and the library button still work.
            let capture_shortcut = register_capture_shortcut(app.handle());
            let library = Arc::new(Library::open_index(root)?);
            maintain_library(app.handle().clone(), library.clone());
            app.manage(AppState {
                library,
                session: Mutex::default(),
                capture_shortcut,
            });
            if let Some(main) = app.get_webview_window("main") {
                platform::disable_hide_animation(&main);
            }
            tray::create(app.handle(), capture_shortcut)?;
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
            commands::overlay_frame,
            commands::finish_capture,
            commands::cancel_capture,
            commands::capture_shortcut,
            commands::list_items,
            commands::count_items,
            commands::item_position,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
