//! Panorama and GIF recordings: after the region is chosen in the capture
//! overlay, it is captured again and again while the user scrolls or clicks
//! in it, until "Done" in the recording bar or the capture hotkey.
//!
//! A frame around the region and the bar stay outside of it and, where the
//! OS allows, out of the captures as well.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use zwopp_core::capture::{DesktopRect, Region};
use zwopp_core::record::{self, GifRecorder, Panorama, Step};

use crate::capture::{self, Capture};
use crate::{AppState, main_window, platform};

pub const FRAME_LABEL: &str = "recorder-frame";
pub const BAR_LABEL: &str = "recorder-bar";
const PROGRESS_EVENT: &str = "recording:progress";
/// Width of the frame around the region, in logical pixels (as in styles.css).
const BORDER: f64 = 3.0;
/// Size of the recording bar, in logical pixels.
const BAR_SIZE: (f64, f64) = (460.0, 52.0);
const BAR_GAP: i32 = 8;
/// How often the mouse buttons are checked during a GIF recording.
const CLICK_POLL: Duration = Duration::from_millis(10);
/// How long a click stays visible in a GIF.
const CLICK_SHOWN: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Panorama,
    Gif,
}

impl Mode {
    /// Pause between two frames: often enough for a smooth GIF (15 fps) and
    /// to keep up with scrolling.
    fn interval(self) -> Duration {
        match self {
            Mode::Panorama => Duration::from_millis(40),
            Mode::Gif => Duration::from_millis(66),
        }
    }
}

/// A running recording; stopped by setting a flag the capture loop checks.
pub struct Recording {
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}

/// For the recording bar.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    mode: Mode,
    seconds: f64,
    /// Panorama: the height joined so far.
    height: u32,
    /// Panorama: the last frames did not fit on, the user scrolled too fast.
    lost: bool,
    /// The limit (height or duration) is reached; it stops by itself.
    full: bool,
}

/// Starts recording `rect` (desktop pixels) from the capture overlay.
pub async fn start(app: &AppHandle, rect: DesktopRect, mode: Mode) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.recording.lock().unwrap().is_some() {
        return Ok(());
    }
    let (main_hidden, pid) =
        capture::take_for_recording(app, rect).ok_or("no capture in progress")?;
    // Only the clamped rectangle: a monitor handle cannot move to another
    // thread, so the capture thread looks the region up again.
    let rect = match Region::new(rect) {
        Ok(region) => region.rect(),
        Err(e) => {
            if main_hidden {
                main_window::show(app);
            }
            return Err(e.to_string());
        }
    };
    let stop = Arc::new(AtomicBool::new(false));
    let cancel = Arc::new(AtomicBool::new(false));
    *state.recording.lock().unwrap() = Some(Recording {
        stop: stop.clone(),
        cancel: cancel.clone(),
    });
    if let Err(e) = open_windows(app, rect) {
        eprintln!("could not open the recording bar: {e}");
    }

    let app = app.clone();
    std::thread::spawn(move || {
        let result = Region::new(rect)
            .map_err(err)
            .and_then(|region| record(&app, &region, mode, &stop));
        close_windows(&app);
        app.state::<AppState>().recording.lock().unwrap().take();
        match result {
            Ok(_) if cancel.load(Ordering::Relaxed) => {}
            Ok(capture) => {
                if let Err(e) = capture::store(&app, capture, pid) {
                    eprintln!("could not save the recording: {e}");
                }
            }
            Err(e) => eprintln!("recording failed: {e}"),
        }
        if main_hidden {
            main_window::show(&app);
        }
    });
    Ok(())
}

/// Ends the recording and keeps it; false if none is running.
pub fn stop(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let recording = state.recording.lock().unwrap();
    let Some(recording) = recording.as_ref() else {
        return false;
    };
    recording.stop.store(true, Ordering::Relaxed);
    true
}

/// Ends the recording without keeping it.
pub fn cancel(app: &AppHandle) {
    if let Some(recording) = app.state::<AppState>().recording.lock().unwrap().as_ref() {
        recording.cancel.store(true, Ordering::Relaxed);
        recording.stop.store(true, Ordering::Relaxed);
    }
}

/// The capture loop, until `stop` is set or a limit is reached.
fn record(
    app: &AppHandle,
    region: &Region,
    mode: Mode,
    stop: &AtomicBool,
) -> Result<Capture, String> {
    let start = Instant::now();
    let first = region.capture().map_err(err)?;
    let mut last_progress = Instant::now();
    let mut progress = |height: u32, lost: bool, full: bool| {
        if full || last_progress.elapsed() >= Duration::from_millis(200) {
            last_progress = Instant::now();
            let _ = app.emit_to(
                BAR_LABEL,
                PROGRESS_EVENT,
                Progress {
                    mode,
                    seconds: start.elapsed().as_secs_f64(),
                    height,
                    lost,
                    full,
                },
            );
        }
    };

    match mode {
        Mode::Panorama => {
            let mut panorama = Panorama::new(&first);
            let mut lost = false;
            let mut previous = first;
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(mode.interval());
                let frame = region.capture().map_err(err)?;
                // Only a frame that stands still: while an app scrolls
                // smoothly or repaints, a capture can catch it half drawn.
                let settled = frame == previous;
                previous = frame;
                if !settled {
                    progress(panorama.height(), lost, false);
                    continue;
                }
                match panorama.push(&previous) {
                    Step::Added(_) => lost = false,
                    Step::Lost => lost = true,
                    Step::Same => {}
                    Step::Full => {
                        progress(panorama.height(), false, true);
                        break;
                    }
                }
                progress(panorama.height(), lost, false);
            }
            Ok(Capture::Still(panorama.finish()))
        }
        Mode::Gif => {
            let rect = region.rect();
            let scale = region.scale_factor().round().max(1.0) as u32;
            // A click is shorter than the time between two frames, so the
            // buttons are watched more often, and a click stays visible a
            // moment (milliseconds since `start` of the last press).
            let last_press = Arc::new(AtomicU64::new(u64::MAX));
            let watching = Arc::new(AtomicBool::new(true));
            let watcher = {
                let (last_press, watching) = (last_press.clone(), watching.clone());
                std::thread::spawn(move || {
                    while watching.load(Ordering::Relaxed) {
                        if platform::mouse_pressed() {
                            last_press.store(start.elapsed().as_millis() as u64, Ordering::Relaxed);
                        }
                        std::thread::sleep(CLICK_POLL);
                    }
                })
            };
            let with_pointer = |mut frame: image::RgbaImage| {
                if let Ok(pointer) = app.cursor_position() {
                    // The frame has the region's size in desktop pixels.
                    let x = pointer.x.round() as i32 - rect.x;
                    let y = pointer.y.round() as i32 - rect.y;
                    let now = start.elapsed().as_millis() as u64;
                    let last = last_press.load(Ordering::Relaxed);
                    let pressed = last != u64::MAX
                        && now.saturating_sub(last) < CLICK_SHOWN.as_millis() as u64;
                    record::draw_pointer(&mut frame, x, y, scale, pressed);
                }
                frame
            };
            let poster = with_pointer(first);
            let (width, height) = poster.dimensions();

            // Encoding takes longer than capturing when much changes at
            // once; frames that do not fit into the queue are skipped, the
            // next one shows the change.
            // `None` only marks the end.
            let (frames, queue) = mpsc::sync_channel::<(Option<image::RgbaImage>, u64)>(4);
            let encoder = std::thread::spawn(move || -> Result<Vec<u8>, String> {
                let mut gif = GifRecorder::new(width, height).map_err(err)?;
                let mut end = 0;
                for (frame, ms) in queue {
                    end = ms;
                    if let Some(frame) = frame.filter(|f| f.dimensions() == (width, height)) {
                        gif.push(&frame, ms).map_err(err)?;
                    }
                }
                gif.finish(end).map_err(err)
            });
            let _ = frames.try_send((Some(poster.clone()), 0));
            let limit = Duration::from_secs(record::MAX_GIF_SECONDS);
            let mut failed = None;
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(mode.interval());
                if start.elapsed() >= limit {
                    progress(0, false, true);
                    break;
                }
                let frame = match region.capture() {
                    Ok(frame) => with_pointer(frame),
                    Err(e) => {
                        failed = Some(err(e));
                        break;
                    }
                };
                let _ = frames.try_send((Some(frame), start.elapsed().as_millis() as u64));
                progress(0, false, false);
            }
            watching.store(false, Ordering::Relaxed);
            let _ = watcher.join();
            // The last frame stays until the end.
            let _ = frames.send((None, start.elapsed().as_millis() as u64));
            drop(frames);
            let gif = encoder.join().map_err(|_| "the GIF encoder panicked")??;
            match failed {
                Some(e) => Err(e),
                None => Ok(Capture::Animation { gif, poster }),
            }
        }
    }
}

fn open_windows(app: &AppHandle, rect: DesktopRect) -> tauri::Result<()> {
    let window = |label: &str| -> tauri::Result<WebviewWindow> {
        WebviewWindowBuilder::new(app, label, WebviewUrl::default())
            .title(crate::app_name(app))
            .decorations(false)
            .transparent(true)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .focused(false)
            .visible(false)
            .build()
    };

    let monitor = app
        .monitor_from_point(
            f64::from(rect.x + rect.width as i32 / 2),
            f64::from(rect.y + rect.height as i32 / 2),
        )?
        .or(app.primary_monitor()?);
    let scale = monitor.as_ref().map_or(1.0, |m| m.scale_factor());
    // The CSS border in physical pixels, so it stays outside the region.
    let border = (BORDER * scale).ceil() as i32;

    let frame = window(FRAME_LABEL)?;
    frame.set_position(PhysicalPosition::new(rect.x - border, rect.y - border))?;
    frame.set_size(PhysicalSize::new(
        rect.width + 2 * border as u32,
        rect.height + 2 * border as u32,
    ))?;
    frame.set_ignore_cursor_events(true)?;
    platform::exclude_from_capture(&frame, true);
    frame.show()?;

    let bar = window(BAR_LABEL)?;
    let width = (BAR_SIZE.0 * scale) as i32;
    let height = (BAR_SIZE.1 * scale) as i32;
    let (top, bottom, left, right) =
        monitor
            .as_ref()
            .map_or((i32::MIN, i32::MAX, i32::MIN, i32::MAX), |m| {
                let (p, s) = (m.position(), m.size());
                (p.y, p.y + s.height as i32, p.x, p.x + s.width as i32)
            });
    let below = rect.y + rect.height as i32 + border + BAR_GAP;
    let above = rect.y - border - BAR_GAP - height;
    // Below the region, else above it, else inside at the bottom.
    let y = if below + height <= bottom {
        below
    } else if above >= top {
        above
    } else {
        rect.y + rect.height as i32 - height - BAR_GAP
    };
    let x = (rect.x + rect.width as i32 / 2 - width / 2).clamp(left, (right - width).max(left));
    bar.set_size(PhysicalSize::new(width as u32, height as u32))?;
    bar.set_position(PhysicalPosition::new(x, y))?;
    platform::exclude_from_capture(&bar, true);
    bar.show()
}

fn close_windows(app: &AppHandle) {
    for label in [FRAME_LABEL, BAR_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.destroy();
        }
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
