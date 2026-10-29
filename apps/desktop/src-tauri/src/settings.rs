//! Applying the user settings (stored by `zwopp_core::settings`): the
//! capture hotkey, and what the settings page shows.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use zwopp_core::settings::Settings;

use crate::{AppState, tray};

/// Global hotkeys that start a region capture, in order of preference. Another
/// app may own one already, so the first free one is used.
const CAPTURE_SHORTCUTS: &[&str] = &[
    "CommandOrControl+Shift+X",
    "CommandOrControl+Alt+X",
    "CommandOrControl+Shift+2",
];

/// The settings plus what is in effect, for the settings page.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInfo {
    pub settings: Settings,
    /// The library folder in use; a changed setting applies after a restart.
    pub library_dir: PathBuf,
    /// The library folder used when none is set.
    pub default_library_dir: PathBuf,
    /// Set by `ZWOPP_LIBRARY_DIR`, which wins over the setting.
    pub library_dir_from_env: bool,
    /// The registered capture hotkey, if any could be registered.
    pub capture_shortcut: Option<String>,
}

pub fn file(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_config_dir()?.join("settings.json"))
}

pub fn default_library_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("library"))
}

/// Reads the settings; a broken file is kept aside and replaced by defaults.
pub fn load(app: &AppHandle) -> tauri::Result<Settings> {
    let path = file(app)?;
    Ok(Settings::load(&path).unwrap_or_else(|e| {
        eprintln!("could not read the settings, using defaults: {e}");
        let _ = std::fs::rename(&path, path.with_extension("json.broken"));
        Settings::default()
    }))
}

fn register(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|e| format!("{accelerator}: {e}"))?;
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("{accelerator}: {e}"))
}

/// Registers `preferred`, or else the first free default; returns the one
/// registered. Without a hotkey the tray menu and the library button still work.
pub fn register_capture_shortcut(app: &AppHandle, preferred: Option<&str>) -> Option<String> {
    preferred
        .into_iter()
        .chain(CAPTURE_SHORTCUTS.iter().copied())
        .find(|accelerator| match register(app, accelerator) {
            Ok(()) => true,
            Err(err) => {
                eprintln!("could not register {err}");
                false
            }
        })
        .map(String::from)
}

/// Switches the capture hotkey; `None` takes the first free default. If the
/// new one is taken, the previous one stays and the error says why.
fn change_capture_shortcut(
    app: &AppHandle,
    wanted: Option<&str>,
) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    let previous = state.capture_shortcut.lock().unwrap().clone();
    let _ = app.global_shortcut().unregister_all();
    let active = match wanted {
        Some(accelerator) => match register(app, accelerator) {
            Ok(()) => Some(accelerator.to_string()),
            Err(e) => {
                if let Some(previous) = &previous {
                    let _ = register(app, previous);
                }
                return Err(e);
            }
        },
        None => register_capture_shortcut(app, None),
    };
    *state.capture_shortcut.lock().unwrap() = active.clone();
    if let Some(menu) = app.try_state::<tray::TrayMenu>() {
        let _ = tray::set_shortcut(&menu, active.as_deref());
    }
    Ok(active)
}

pub fn info(app: &AppHandle) -> tauri::Result<SettingsInfo> {
    let state = app.state::<AppState>();
    Ok(SettingsInfo {
        settings: state.settings.lock().unwrap().clone(),
        library_dir: state.library.root().to_path_buf(),
        default_library_dir: default_library_dir(app)?,
        library_dir_from_env: std::env::var_os("ZWOPP_LIBRARY_DIR").is_some(),
        capture_shortcut: state.capture_shortcut.lock().unwrap().clone(),
    })
}

/// Applies and stores `next`, then tells every window.
pub fn save(app: &AppHandle, mut next: Settings) -> Result<SettingsInfo, String> {
    let state = app.state::<AppState>();
    let current = state.settings.lock().unwrap().clone();
    if next.capture_hotkey != current.capture_hotkey {
        change_capture_shortcut(app, next.capture_hotkey.as_deref())?;
    }
    if next.library_dir.as_deref() == Some(default_library_dir(app).map_err(err)?.as_path()) {
        next.library_dir = None;
    }
    next.save(&file(app).map_err(err)?).map_err(err)?;
    *state.settings.lock().unwrap() = next.clone();
    let _ = app.emit("settings:changed", &next);
    info(app).map_err(err)
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
