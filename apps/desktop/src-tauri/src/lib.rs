mod capture;
mod commands;
mod platform;
mod tray;

use std::sync::Mutex;

use screenbook_core::library::Library;
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Global hotkey that starts a region capture.
pub const CAPTURE_SHORTCUT: &str = "CommandOrControl+Shift+X";

pub struct AppState {
    pub library: Library,
    pub session: Mutex<Option<capture::Session>>,
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
    let shortcut: Shortcut = CAPTURE_SHORTCUT.parse().expect("valid shortcut");

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, pressed, event| {
                    if pressed == &shortcut && event.state() == ShortcutState::Pressed {
                        capture::start_in_background(app.clone());
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let root = app.path().app_data_dir()?.join("library");
            app.manage(AppState {
                library: Library::open(root)?,
                session: Mutex::default(),
            });
            if let Some(main) = app.get_webview_window("main") {
                platform::disable_hide_animation(&main);
            }
            tray::create(app.handle())?;
            // Another app may already own the hotkey; the tray menu still works then.
            if let Err(err) = app.global_shortcut().register(shortcut) {
                eprintln!("could not register {CAPTURE_SHORTCUT}: {err}");
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
            commands::overlay_frame,
            commands::finish_capture,
            commands::cancel_capture,
            commands::list_items,
            commands::delete_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
