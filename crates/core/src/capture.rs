//! Screen capture.
//!
//! The capture flow is "freeze first, select later": every monitor is captured
//! in full the moment the user presses the hotkey, and the region is cut out of
//! that frozen frame afterwards (see `docs/adr/0002-frozen-frame-capture.md`).

use image::RgbaImage;
use serde::{Deserialize, Serialize};
use xcap::Monitor;

use crate::{Error, Result};

/// Static information about a monitor, as reported by the OS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub is_primary: bool,
}

/// A full-resolution snapshot of one monitor.
pub struct Frame {
    pub monitor: MonitorInfo,
    pub image: RgbaImage,
}

/// A rectangle in image pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

fn info(monitor: &Monitor) -> Result<MonitorInfo> {
    Ok(MonitorInfo {
        id: monitor.id()?,
        name: monitor.friendly_name().or_else(|_| monitor.name())?,
        x: monitor.x()?,
        y: monitor.y()?,
        width: monitor.width()?,
        height: monitor.height()?,
        scale_factor: monitor.scale_factor()?,
        is_primary: monitor.is_primary()?,
    })
}

/// Lists all connected monitors.
pub fn monitors() -> Result<Vec<MonitorInfo>> {
    Monitor::all()?.iter().map(info).collect()
}

/// Captures the monitor that contains the given point.
///
/// The point uses the OS's native desktop coordinates (physical pixels on
/// Windows and X11, points on macOS).
pub fn capture_monitor_at(x: i32, y: i32) -> Result<Frame> {
    let monitor = Monitor::from_point(x, y).map_err(|_| Error::NoMonitor { x, y })?;
    Ok(Frame {
        monitor: info(&monitor)?,
        image: monitor.capture_image()?,
    })
}

/// Captures every connected monitor.
pub fn capture_all() -> Result<Vec<Frame>> {
    Monitor::all()?
        .iter()
        .map(|monitor| {
            Ok(Frame {
                monitor: info(monitor)?,
                image: monitor.capture_image()?,
            })
        })
        .collect()
}

/// A rectangle in desktop pixels: the coordinate space all monitors share
/// (physical pixels, origin at the primary monitor's top-left corner).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl DesktopRect {
    fn right(&self) -> i32 {
        self.x + self.width as i32
    }

    fn bottom(&self) -> i32 {
        self.y + self.height as i32
    }

    /// The overlap of two rectangles, if any.
    pub fn intersect(&self, other: &DesktopRect) -> Option<DesktopRect> {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let right = self.right().min(other.right());
        let bottom = self.bottom().min(other.bottom());
        (right > x && bottom > y).then(|| DesktopRect {
            x,
            y,
            width: (right - x) as u32,
            height: (bottom - y) as u32,
        })
    }
}

/// A frozen monitor image and where it sits on the desktop.
pub struct PlacedFrame<'a> {
    pub image: &'a RgbaImage,
    pub x: i32,
    pub y: i32,
}

impl PlacedFrame<'_> {
    fn bounds(&self) -> DesktopRect {
        DesktopRect {
            x: self.x,
            y: self.y,
            width: self.image.width(),
            height: self.image.height(),
        }
    }
}

/// Cuts `rect` out of the frozen monitor images, also across monitors. The
/// result is trimmed to the area the monitors cover; gaps between monitors
/// of different sizes stay transparent.
pub fn compose(frames: &[PlacedFrame], rect: DesktopRect) -> Result<RgbaImage> {
    let parts: Vec<_> = frames
        .iter()
        .filter_map(|frame| Some((frame, frame.bounds().intersect(&rect)?)))
        .collect();
    let Some(area) = parts.iter().map(|(_, part)| *part).reduce(|a, b| {
        let x = a.x.min(b.x);
        let y = a.y.min(b.y);
        DesktopRect {
            x,
            y,
            width: (a.right().max(b.right()) - x) as u32,
            height: (a.bottom().max(b.bottom()) - y) as u32,
        }
    }) else {
        return Err(Error::EmptyRegion);
    };
    let mut out = RgbaImage::new(area.width, area.height);
    for (frame, part) in parts {
        let piece = image::imageops::crop_imm(
            frame.image,
            (part.x - frame.x) as u32,
            (part.y - frame.y) as u32,
            part.width,
            part.height,
        )
        .to_image();
        image::imageops::replace(
            &mut out,
            &piece,
            (part.x - area.x).into(),
            (part.y - area.y).into(),
        );
    }
    Ok(out)
}

/// The visible top-level windows, topmost first, in desktop pixels, without
/// those of process `exclude_pid` (our own) and minimized or tiny ones. Best
/// effort: where the OS does not tell (e.g. Wayland), the list is empty.
pub fn windows(exclude_pid: u32) -> Vec<DesktopRect> {
    let Ok(all) = xcap::Window::all() else {
        return Vec::new();
    };
    all.iter()
        .filter_map(|window| {
            if window.pid().ok()? == exclude_pid || window.is_minimized().ok()? {
                return None;
            }
            // macOS reports points; the desktop space is in pixels.
            let scale = if cfg!(target_os = "macos") {
                window.current_monitor().ok()?.scale_factor().ok()?
            } else {
                1.0
            };
            let px = |v: f32| (v * scale).round();
            let rect = DesktopRect {
                x: px(window.x().ok()? as f32) as i32,
                y: px(window.y().ok()? as f32) as i32,
                width: px(window.width().ok()? as f32) as u32,
                height: px(window.height().ok()? as f32) as u32,
            };
            (rect.width >= 8 && rect.height >= 8).then_some(rect)
        })
        .collect()
}

/// Cuts `rect` out of `image`, clamped to the image bounds.
pub fn crop(image: &RgbaImage, rect: Rect) -> Result<RgbaImage> {
    let x = rect.x.min(image.width());
    let y = rect.y.min(image.height());
    let width = rect.width.min(image.width() - x);
    let height = rect.height.min(image.height() - y);
    if width == 0 || height == 0 {
        return Err(Error::EmptyRegion);
    }
    Ok(image::imageops::crop_imm(image, x, y, width, height).to_image())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(width: u32, height: u32) -> RgbaImage {
        RgbaImage::from_fn(width, height, |x, y| {
            image::Rgba([x as u8, y as u8, 0, 255])
        })
    }

    fn rect(x: u32, y: u32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    fn desktop(x: i32, y: i32, width: u32, height: u32) -> DesktopRect {
        DesktopRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn rectangles_intersect() {
        let a = desktop(0, 0, 100, 50);
        assert_eq!(
            a.intersect(&desktop(50, 25, 100, 100)),
            Some(desktop(50, 25, 50, 25))
        );
        assert_eq!(a.intersect(&desktop(100, 0, 10, 10)), None);
    }

    #[test]
    fn compose_spans_monitors() {
        // Left monitor 100 × 50, right one 80 × 40 next to it, top-aligned.
        let left = RgbaImage::from_pixel(100, 50, image::Rgba([255, 0, 0, 255]));
        let right = RgbaImage::from_pixel(80, 40, image::Rgba([0, 0, 255, 255]));
        let frames = [
            PlacedFrame {
                image: &left,
                x: 0,
                y: 0,
            },
            PlacedFrame {
                image: &right,
                x: 100,
                y: 0,
            },
        ];
        let out = compose(&frames, desktop(90, 30, 20, 20)).unwrap();
        assert_eq!(out.dimensions(), (20, 20));
        assert_eq!(out.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(out.get_pixel(15, 0).0, [0, 0, 255, 255]);
        // Below the shorter right monitor: transparent.
        assert_eq!(out.get_pixel(15, 15).0, [0, 0, 0, 0]);
    }

    #[test]
    fn compose_trims_to_the_monitors() {
        let screen = image(100, 50);
        let frames = [PlacedFrame {
            image: &screen,
            x: -100,
            y: 0,
        }];
        // A window hanging over the edge is cut at the screen.
        let out = compose(&frames, desktop(-20, 10, 50, 10)).unwrap();
        assert_eq!(out.dimensions(), (20, 10));
        assert_eq!(out.get_pixel(0, 0).0, [80, 10, 0, 255]);
        assert!(matches!(
            compose(&frames, desktop(10, 10, 5, 5)),
            Err(Error::EmptyRegion)
        ));
    }

    #[test]
    fn crop_inside() {
        let out = crop(&image(100, 50), rect(10, 5, 20, 10)).unwrap();
        assert_eq!(out.dimensions(), (20, 10));
        assert_eq!(out.get_pixel(0, 0).0, [10, 5, 0, 255]);
    }

    #[test]
    fn crop_is_clamped_to_bounds() {
        let out = crop(&image(100, 50), rect(90, 40, 50, 50)).unwrap();
        assert_eq!(out.dimensions(), (10, 10));
    }

    #[test]
    fn crop_empty_region_fails() {
        let img = image(100, 50);
        assert!(matches!(
            crop(&img, rect(10, 10, 0, 5)),
            Err(Error::EmptyRegion)
        ));
        assert!(matches!(
            crop(&img, rect(200, 10, 5, 5)),
            Err(Error::EmptyRegion)
        ));
    }
}
