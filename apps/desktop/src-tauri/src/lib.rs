mod capture;
mod commands;
mod main_window;
mod platform;
mod recording;
mod report;
mod settings;
mod thumbs;
mod tray;
mod update;

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
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
    /// A panorama or GIF recording in progress.
    pub recording: Mutex<Option<recording::Recording>>,
}

/// Syncs the index with the item folders and creates missing thumbnails,
/// off the main thread so even a huge library opens instantly. The UI
/// refreshes on the `library:indexed` / `library:thumbnails` events.
fn maintain_library(app: AppHandle, library: Arc<Library>) {
    std::thread::spawn(move || {
        match library.reindex() {
            Ok(()) => drop(app.emit("library:indexed", ())),
            Err(err) => log::warn!("reindex failed: {err}"),
        }
        match library.ensure_thumbnails() {
            Ok(0) => {}
            Ok(_) => drop(app.emit("library:thumbnails", ())),
            Err(err) => log::warn!("thumbnails failed: {err}"),
        }
    });
}

/// The log file is started anew beyond this size (the previous one is kept).
const LOG_FILE_SIZE: u128 = 512 * 1024;

/// The argument the system passes when it starts Zwopp at login: it then
/// starts in the tray, without opening the window.
pub const AUTOSTART_ARG: &str = "--autostart";

/// "Zwopp", or "Zwopp Dev" for a development build.
pub fn app_name(app: &AppHandle) -> String {
    app.config()
        .product_name
        .clone()
        .unwrap_or_else(|| "Zwopp".into())
}

/// The configuration, for a development build changed so it never meets an
/// installed Zwopp: its own identifier gives it its own settings, library,
/// webview data and single-instance lock (see ADR 0008).
fn context() -> tauri::Context {
    let mut context = tauri::generate_context!();
    if tauri::is_dev() {
        let config = context.config_mut();
        config.identifier.push_str(".dev");
        config.product_name = Some("Zwopp Dev".into());
    }
    context
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second start only brings the running Zwopp forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            main_window::show(app)
        }))
        // Warnings and errors go to a small log file, which "Report a problem"
        // offers to attach (report.rs).
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::LogDir {
                        file_name: Some(report::LOG_FILE.into()),
                    }),
                    Target::new(TargetKind::Stderr),
                ])
                .level(log::LevelFilter::Info)
                .max_file_size(LOG_FILE_SIZE)
                .rotation_strategy(RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol(thumbs::SCHEME, thumbs::handle)
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            // Only the capture hotkey is ever registered.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // During a recording the hotkey ends it.
                    if event.state() == ShortcutState::Pressed && !recording::stop(app) {
                        capture::start_in_background(app.clone(), std::time::Duration::ZERO);
                    }
                })
                .build(),
        )
        .setup(|app| {
            log::info!(
                "{} {} on {} ({})",
                app_name(app.handle()),
                app.package_info().version,
                os_info::get(),
                std::env::consts::ARCH
            );
            // A crash leaves a line in the log, for "Report a problem".
            let previous = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |panic| {
                log::error!("{panic}");
                previous(panic);
            }));
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
            tray::create(app.handle(), capture_shortcut.as_deref())?;
            app.manage(main_window::MainWindow::default());
            app.manage(update::Updates::default());
            update::watch(app.handle().clone());
            app.manage(AppState {
                library,
                session: Mutex::default(),
                settings: Mutex::new(settings),
                capture_shortcut: Mutex::new(capture_shortcut),
                export_dir: Mutex::default(),
                recording: Mutex::default(),
            });
            // Loaded now, so the first capture does not wait for webviews to start.
            let monitors = app.available_monitors()?;
            if let Err(e) = capture::prepare_overlays(app.handle(), &monitors) {
                log::warn!("could not prepare the capture overlays: {e}");
            }
            if !std::env::args().any(|arg| arg == AUTOSTART_ARG) {
                main_window::show(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the app running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == main_window::LABEL
            {
                api.prevent_close();
                main_window::close(window);
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
            commands::take_view,
            commands::start_recording,
            commands::stop_recording,
            commands::cancel_recording,
            commands::report_info,
            commands::open_issue,
            commands::open_log_folder,
            commands::update_status,
            commands::check_update,
            commands::install_update,
            commands::autostart,
            commands::set_autostart,
        ])
        .build(context())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Without windows (the main one is destroyed while closed) the app
            // stays in the tray; only "Quit" (an explicit exit code) ends it.
            if let RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                api.prevent_exit();
            }
        });
}
