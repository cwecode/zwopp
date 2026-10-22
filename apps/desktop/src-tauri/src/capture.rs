//! Region capture: freeze all monitors, show one selection overlay per monitor,
//! then cut the selected region out of the frozen frame.

use std::sync::Arc;
use std::time::Duration;

use image::RgbaImage;
use screenbook_core::capture::{self, Rect};
use screenbook_core::library::LibraryItem;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::AppState;

pub const OVERLAY_PREFIX: &str = "overlay-";

/// An ongoing capture. `frames[i]` belongs to the window `overlay-{i}`.
pub struct Session {
    pub frames: Vec<Arc<RgbaImage>>,
    main_was_visible: bool,
}

pub fn start_in_background(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = start(&app) {
            eprintln!("capture failed: {err}");
            finish(&app);
        }
    });
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.session.lock().unwrap().is_some() {
        return Ok(());
    }

    // Keep our own window out of the screenshot. The hide animation is disabled
    // (see `platform`); the pause only lets the compositor repaint the desktop.
    let main = app.get_webview_window("main");
    let main_was_visible = main
        .as_ref()
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    if let Some(main) = main.filter(|_| main_was_visible) {
        main.hide().map_err(err)?;
        std::thread::sleep(Duration::from_millis(200));
    }

    let monitors = app.available_monitors().map_err(err)?;
    let frames = monitors
        .iter()
        .map(|monitor| {
            let (x, y) = native_center(monitor);
            capture::capture_monitor_at(x, y).map(|frame| Arc::new(frame.image))
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    *state.session.lock().unwrap() = Some(Session {
        frames,
        main_was_visible,
    });

    for (index, monitor) in monitors.iter().enumerate() {
        // Created hidden; the overlay shows itself once the frozen frame is painted.
        let window = WebviewWindowBuilder::new(
            app,
            format!("{OVERLAY_PREFIX}{index}"),
            WebviewUrl::default(),
        )
        .title("Screenbook")
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(err)?;
        window.set_position(*monitor.position()).map_err(err)?;
        window.set_size(*monitor.size()).map_err(err)?;
    }
    Ok(())
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

/// Encodes a frozen frame as PNG for the overlay. Speed matters more than size here.
pub fn preview_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    use image::ImageEncoder;
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};

    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::NoFilter)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(err)?;
    Ok(png)
}

/// Saves the selected region to the library and copies it to the clipboard.
pub fn complete(app: &AppHandle, index: usize, rect: Rect) -> Result<LibraryItem, String> {
    let state = app.state::<AppState>();
    let frame = state
        .session
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|session| session.frames.get(index).cloned())
        .ok_or("no capture in progress")?;

    let image = capture::crop(&frame, rect).map_err(err)?;
    let item = state.library.add(&image).map_err(err)?;

    let clip = tauri::image::Image::new(image.as_raw(), image.width(), image.height());
    if let Err(e) = app.clipboard().write_image(&clip) {
        eprintln!("could not copy to clipboard: {e}");
    }

    finish(app);
    crate::show_main(app);
    let _ = app.emit("library:changed", &item);
    Ok(item)
}

/// Ends the session and closes all overlays.
pub fn finish(app: &AppHandle) {
    let session = app.state::<AppState>().session.lock().unwrap().take();
    for (label, window) in app.webview_windows() {
        if label.starts_with(OVERLAY_PREFIX) {
            let _ = window.destroy();
        }
    }
    if session.is_some_and(|s| s.main_was_visible) {
        crate::show_main(app);
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
