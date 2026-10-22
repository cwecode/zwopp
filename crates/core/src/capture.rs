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
