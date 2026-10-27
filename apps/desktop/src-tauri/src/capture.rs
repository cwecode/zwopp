//! Region capture: freeze all monitors, show one selection overlay per monitor,
//! then cut the selected region out of the frozen frames (also across monitors).

use std::sync::Arc;
use std::time::Duration;

use image::RgbaImage;
use screenbook_core::capture::{self, DesktopRect, PlacedFrame};
use screenbook_core::library::LibraryItem;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::AppState;

pub const OVERLAY_PREFIX: &str = "overlay-";

/// A frozen monitor image and its top-left corner in desktop pixels.
pub struct Frozen {
    pub image: Arc<RgbaImage>,
    x: i32,
    y: i32,
}

/// An ongoing capture. `frames[i]` belongs to the window `overlay-{i}`.
pub struct Session {
    pub frames: Vec<Frozen>,
    /// Visible windows at the moment of the capture, topmost first.
    windows: Vec<DesktopRect>,
    main_was_visible: bool,
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

    // Keep our own window out of the screenshot. The hide animation is disabled
    // (see `platform`); the pause only lets the compositor repaint the desktop.
    let main = app.get_webview_window("main");
    let main_was_visible = main
        .as_ref()
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    if let Some(main) = main.filter(|_| main_was_visible) {
        main.hide().map_err(err)?;
    }
    let repaint = if main_was_visible {
        Duration::from_millis(200)
    } else {
        Duration::ZERO
    };
    pause(delay.max(repaint)).await;

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
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let windows = capture::windows(std::process::id());

    *state.session.lock().unwrap() = Some(Session {
        frames,
        windows,
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

/// Saves the selected region (desktop pixels, may span monitors) to the
/// library and copies it to the clipboard.
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
