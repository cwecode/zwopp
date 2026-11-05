//! The main window (library, editor, settings) only exists while it is used.
//!
//! Closing it hides it; if it stays closed for `KEEP_LOADED`, it is destroyed,
//! which frees its webview, by far the largest part of Zwopp's memory. Opening
//! it again creates it anew. In between, only the tray, the hotkey and the
//! hidden capture overlays remain.
//!
//! A view to open (the editor after a capture, the settings) waits here until
//! the window takes it, so a window that is still loading does not miss it.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, Window};
use zwopp_core::library::LibraryItem;

use crate::platform;

pub const LABEL: &str = "main";
/// How long a closed window stays loaded, so reopening it soon is instant.
const KEEP_LOADED: Duration = Duration::from_secs(120);
/// Tells a loaded window that a view waits (`take_view`).
const VIEW_EVENT: &str = "app:view";

/// A view the window should switch to (`View` in App.tsx).
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum View {
    Editor {
        item: Box<LibraryItem>,
    },
    Settings,
    /// "Report a problem".
    Report,
}

#[derive(Default)]
pub struct MainWindow {
    view: Mutex<Option<View>>,
    /// Counts the openings; a pending destroy only applies if none came since.
    opened: AtomicU64,
}

/// Brings the window to the front, creating it if needed.
pub fn show(app: &AppHandle) {
    app.state::<MainWindow>()
        .opened
        .fetch_add(1, Ordering::Relaxed);
    let shown = get_or_create(app).and_then(|window| {
        window.unminimize()?;
        window.show()?;
        window.set_focus()
    });
    if let Err(e) = shown {
        log::warn!("could not show the main window: {e}");
    }
}

/// Shows the window with `view`.
pub fn show_view(app: &AppHandle, view: View) {
    *app.state::<MainWindow>().view.lock().unwrap() = Some(view);
    show(app);
    let _ = app.emit_to(LABEL, VIEW_EVENT, ());
}

/// The view waiting for the window, if any; asked for when it has loaded and
/// on every `app:view` event.
pub fn take_view(app: &AppHandle) -> Option<View> {
    app.state::<MainWindow>().view.lock().unwrap().take()
}

/// Hides the window instead of closing it, and destroys it once it has been
/// closed for `KEEP_LOADED`. The editor saves within a second, so nothing is
/// pending by then.
pub fn close(window: &Window) {
    let _ = window.hide();
    let app = window.app_handle().clone();
    let opened = app.state::<MainWindow>().opened.load(Ordering::Relaxed);
    // A sleeping thread costs nothing while it waits.
    std::thread::spawn(move || {
        std::thread::sleep(KEEP_LOADED);
        if app.state::<MainWindow>().opened.load(Ordering::Relaxed) != opened {
            return;
        }
        if let Some(window) = app.get_webview_window(LABEL)
            && !window.is_visible().unwrap_or(true)
        {
            let _ = window.destroy();
        }
    });
}

/// The window, created from its configuration in tauri.conf.json (where
/// `create: false` keeps it from being created at startup).
fn get_or_create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == LABEL)
        .expect("tauri.conf.json configures the main window");
    let window = WebviewWindowBuilder::from_config(app, config)?
        .title(crate::app_name(app))
        .build()?;
    platform::disable_hide_animation(&window);
    Ok(window)
}
