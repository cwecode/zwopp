//! Region capture: freeze all monitors, show one selection overlay per monitor,
//! then cut the selected region out of the frozen frames (also across monitors).
//!
//! The overlay windows are created once and only hidden between captures, so
//! a capture does not wait for webviews to start and load the UI.

use std::sync::Arc;
use std::time::Duration;

use image::RgbaImage;
use screenbook_core::capture::{self, DesktopRect, PlacedFrame};
use screenbook_core::library::LibraryItem;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{AppState, platform};

pub const OVERLAY_PREFIX: &str = "overlay-";
/// Tells the (already loaded) overlays that a new capture is ready.
const START_EVENT: &str = "capture:start";

/// A frozen monitor image and its top-left corner in desktop pixels.
pub struct Frozen {
    pub image: Arc<RgbaImage>,
    x: i32,
    y: i32,
}

/// An ongoing capture. `frames[i]` belongs to the window `overlay-{i}`.
pub struct Session {
    pub frames: Vec<Frozen>,
    /// `frames` as PNG for the overlays, encoded right after the freeze.
    pub previews: Vec<Arc<Vec<u8>>>,
    /// Visible windows at the moment of the capture, topmost first.
    windows: Vec<DesktopRect>,
    /// The main window was hidden for the capture and comes back afterwards.
    main_hidden: bool,
}

/// Where the monitors and windows were, for the overlays (desktop pixels).
#[derive(Serialize)]
pub struct Layout {
    monitors: Vec<DesktopRect>,
    windows: Vec<DesktopRect>,
}

/// Starts a capture after `delay` without blocking the caller.
pub fn start_in_background(app: AppHandle, delay: Duration) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = start(&app, delay).await {
            eprintln!("capture failed: {err}");
            finish(&app);
        }
    });
}

/// Freezes all monitors (after `delay`, e.g. to open a menu first) and opens
/// the selection overlays.
pub async fn start(app: &AppHandle, delay: Duration) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.session.lock().unwrap().is_some() {
        return Ok(());
    }

    // Keep our own window out of the screenshot. Where the OS can leave it out
    // of captures, it stays open (and awake for the editor) for that moment;
    // otherwise, and with a delay to clear the view, it hides. The hide
    // animation is disabled (see `platform`); the pauses let the compositor
    // apply the change before the freeze.
    let main = app
        .get_webview_window("main")
        .filter(|w| w.is_visible().unwrap_or(false));
    let excluded = delay.is_zero()
        && main
            .as_ref()
            .is_some_and(|w| platform::exclude_from_capture(w, true));
    let main_hidden = main.is_some() && !excluded;
    if let Some(main) = main.as_ref().filter(|_| main_hidden) {
        main.hide().map_err(err)?;
    }
    let settle = if main_hidden {
        Duration::from_millis(200)
    } else if excluded {
        Duration::from_millis(50)
    } else {
        Duration::ZERO
    };
    pause(delay.max(settle)).await;

    let monitors = app.available_monitors().map_err(err)?;
    let frames = monitors
        .iter()
        .map(|monitor| {
            let (x, y) = native_center(monitor);
            let position = monitor.position();
            capture::capture_monitor_at(x, y).map(|frame| Frozen {
                image: Arc::new(frame.image),
                x: position.x,
                y: position.y,
            })
        })
        .collect::<Result<Vec<_>, _>>();
    // Visible to screen sharing and other tools again.
    if let Some(main) = main.as_ref().filter(|_| excluded) {
        platform::exclude_from_capture(main, false);
    }
    let frames = frames.map_err(err)?;
    let windows = capture::windows(std::process::id());
    // All monitors at once: the overlays ask for these first.
    let previews = std::thread::scope(|scope| {
        let jobs: Vec<_> = frames
            .iter()
            .map(|frame| scope.spawn(|| capture::preview_png(&frame.image)))
            .collect();
        jobs.into_iter()
            .map(|job| job.join().expect("preview encoder panicked").map(Arc::new))
            .collect::<Result<Vec<_>, _>>()
    })
    .map_err(err)?;

    *state.session.lock().unwrap() = Some(Session {
        frames,
        previews,
        windows,
        main_hidden,
    });

    prepare_overlays(app, &monitors)?;
    // Hidden overlays load the new frame and show themselves once it is painted.
    app.emit(START_EVENT, ()).map_err(err)
}

/// Makes sure there is one hidden overlay window per monitor, placed on it.
/// Called at startup too, so even the first capture finds them loaded.
pub fn prepare_overlays(app: &AppHandle, monitors: &[tauri::Monitor]) -> Result<(), String> {
    for (index, monitor) in monitors.iter().enumerate() {
        let label = format!("{OVERLAY_PREFIX}{index}");
        let window = match app.get_webview_window(&label) {
            Some(window) => window,
            None => WebviewWindowBuilder::new(app, label, WebviewUrl::default())
                .title("Screenbook")
                .decorations(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(false)
                .visible(false)
                .build()
                .map_err(err)?,
        };
        window.set_position(*monitor.position()).map_err(err)?;
        window.set_size(*monitor.size()).map_err(err)?;
    }
    // Monitors that were unplugged.
    for (label, window) in app.webview_windows() {
        let index = label
            .strip_prefix(OVERLAY_PREFIX)
            .and_then(|i| i.parse::<usize>().ok());
        if index.is_some_and(|i| i >= monitors.len()) {
            let _ = window.destroy();
        }
    }
    Ok(())
}

/// Waits without holding an async worker.
async fn pause(duration: Duration) {
    if !duration.is_zero() {
        let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
    }
}

/// The center of a monitor in the coordinate space `xcap` expects.
fn native_center(monitor: &tauri::Monitor) -> (i32, i32) {
    let position = monitor.position();
    let size = monitor.size();
    let x = position.x + size.width as i32 / 2;
    let y = position.y + size.height as i32 / 2;
    if cfg!(target_os = "macos") {
        // macOS works in points, Tauri reports physical pixels.
        let scale = monitor.scale_factor();
        ((x as f64 / scale) as i32, (y as f64 / scale) as i32)
    } else {
        (x, y)
    }
}

/// Monitors and windows of the current session, for the overlays.
pub fn layout(app: &AppHandle) -> Result<Layout, String> {
    let state = app.state::<AppState>();
    let session = state.session.lock().unwrap();
    let session = session.as_ref().ok_or("no capture in progress")?;
    Ok(Layout {
        monitors: session
            .frames
            .iter()
            .map(|frame| DesktopRect {
                x: frame.x,
                y: frame.y,
                width: frame.image.width(),
                height: frame.image.height(),
            })
            .collect(),
        windows: session.windows.clone(),
    })
}

/// Saves the selected region (desktop pixels, may span monitors) to the
/// library and, as set in the settings, opens it in the editor and copies
/// it to the clipboard.
pub fn complete(app: &AppHandle, rect: DesktopRect) -> Result<LibraryItem, String> {
    let state = app.state::<AppState>();
    let image = {
        let session = state.session.lock().unwrap();
        let session = session.as_ref().ok_or("no capture in progress")?;
        let frames: Vec<_> = session
            .frames
            .iter()
            .map(|frame| PlacedFrame {
                image: &frame.image,
                x: frame.x,
                y: frame.y,
            })
            .collect();
        capture::compose(&frames, rect).map_err(err)?
    };
    // The overlays go first, so the screen answers the click at once.
    finish(app);
    let item = state.library.add(&image).map_err(err)?;
    let (edit, copy) = {
        let settings = state.settings.lock().unwrap();
        (settings.edit_after_capture, settings.copy_after_capture)
    };
    let _ = app.emit("library:changed", &item);
    if edit {
        crate::show_main(app);
        let _ = app.emit_to("main", "capture:edit", &item);
    }
    if !copy {
        return Ok(item);
    }

    // Nobody waits for the clipboard; converting a large image takes a moment.
    let clipboard = app.clone();
    std::thread::spawn(move || {
        let clip = tauri::image::Image::new(image.as_raw(), image.width(), image.height());
        if let Err(e) = clipboard.clipboard().write_image(&clip) {
            eprintln!("could not copy to clipboard: {e}");
        }
    });
    Ok(item)
}

/// Ends the session and hides the overlays for the next capture.
pub fn finish(app: &AppHandle) {
    let session = app.state::<AppState>().session.lock().unwrap().take();
    for (label, window) in app.webview_windows() {
        if label.starts_with(OVERLAY_PREFIX) {
            let _ = window.hide();
        }
    }
    if session.is_some_and(|s| s.main_hidden) {
        crate::show_main(app);
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
