//! Exports a library item as an image file (PNG, JPEG or WebP), the
//! annotated version if there is one.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use chrono::Local;
use image::codecs::jpeg::JpegEncoder;
use image::{ImageFormat, Rgb, RgbImage, RgbaImage};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{IoContext, Result};
use crate::library::{Library, LibraryItem};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    /// Lossless, keeps transparency. The default.
    Png,
    /// Smallest for photos; transparent areas become white.
    Jpeg,
    /// Lossless WebP, keeps transparency; usually smaller than PNG.
    Webp,
}

/// JPEG quality: text stays crisp, files stay small.
const JPEG_QUALITY: u8 = 90;
/// Longest file name stem, so paths stay well within OS limits.
const MAX_STEM: usize = 100;

impl ExportFormat {
    pub const ALL: [ExportFormat; 3] = [ExportFormat::Png, ExportFormat::Jpeg, ExportFormat::Webp];

    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Png => "png",
            ExportFormat::Jpeg => "jpg",
            ExportFormat::Webp => "webp",
        }
    }

    /// The format a file name asks for (`.png`, `.jpg`/`.jpeg`, `.webp`, any case).
    pub fn from_path(path: &Path) -> Option<Self> {
        let extension = path.extension()?.to_str()?.to_ascii_lowercase();
        match extension.as_str() {
            "png" => Some(ExportFormat::Png),
            "jpg" | "jpeg" => Some(ExportFormat::Jpeg),
            "webp" => Some(ExportFormat::Webp),
            _ => None,
        }
    }
}

/// Encodes an image in `format`.
pub fn encode(image: &RgbaImage, format: ExportFormat) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    match format {
        ExportFormat::Png => image.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)?,
        ExportFormat::Jpeg => {
            JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY).encode_image(&on_white(image))?
        }
        ExportFormat::Webp => {
            out = webp::Encoder::from_rgba(image.as_raw(), image.width(), image.height())
                .encode_lossless()
                .to_vec()
        }
    }
    Ok(out)
}

/// Writes item `id` to `path` in `format`. The file appears complete or not
/// at all; an existing file is replaced.
pub fn export(library: &Library, id: Uuid, path: &Path, format: ExportFormat) -> Result<()> {
    let image = image::open(library.output_path(id)?)?.to_rgba8();
    let bytes = encode(&image, format)?;
    let mut partial = path.as_os_str().to_owned();
    partial.push(".partial");
    let partial = PathBuf::from(partial);
    fs::write(&partial, bytes).at(&partial)?;
    fs::rename(&partial, path)
        .inspect_err(|_| drop(fs::remove_file(&partial)))
        .at(path)
}

/// Exports item `id` into `dir` under its file name (see `file_stem`) and
/// returns the path, e.g. for dragging it into another app.
pub fn export_into(
    library: &Library,
    id: Uuid,
    dir: &Path,
    format: ExportFormat,
) -> Result<PathBuf> {
    let item = library.get(id)?;
    fs::create_dir_all(dir).at(dir)?;
    let path = dir.join(format!("{}.{}", file_stem(&item), format.extension()));
    export(library, id, &path, format)?;
    Ok(path)
}

/// A file name without extension for an item: its title, or
/// "Screenshot 2026-10-27 14-05-09" (local time) if it has none. Characters
/// that Windows or macOS do not allow in file names are left out.
pub fn file_stem(item: &LibraryItem) -> String {
    let title: String = item
        .title
        .chars()
        .filter(|c| !c.is_control() && !r#"<>:"/\|?*"#.contains(*c))
        .collect();
    // Windows also rejects trailing dots and spaces.
    let title = title.trim().trim_end_matches('.').trim_end();
    if title.is_empty() {
        let local = item.created_at.with_timezone(&Local);
        return format!("Screenshot {}", local.format("%Y-%m-%d %H-%M-%S"));
    }
    title.chars().take(MAX_STEM).collect()
}

/// The image composited onto white, for formats without transparency.
fn on_white(image: &RgbaImage) -> RgbImage {
    RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let [r, g, b, a] = image.get_pixel(x, y).0;
        let blend =
            |c: u8| ((u16::from(c) * u16::from(a) + 255 * (255 - u16::from(a)) + 127) / 255) as u8;
        Rgb([blend(r), blend(g), blend(b)])
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing;
    use image::Rgba;

    fn item(title: &str) -> LibraryItem {
        let dir = tempfile::tempdir().unwrap();
        let library = testing::seed(dir.path(), 1).unwrap();
        let id = library.list_page(&Default::default(), 0, 1).unwrap()[0].id;
        LibraryItem {
            title: title.into(),
            ..library.get(id).unwrap()
        }
    }

    #[test]
    fn formats_follow_the_file_extension() {
        assert_eq!(
            ExportFormat::from_path(Path::new("a.PNG")),
            Some(ExportFormat::Png)
        );
        assert_eq!(
            ExportFormat::from_path(Path::new("a.jpeg")),
            Some(ExportFormat::Jpeg)
        );
        assert_eq!(
            ExportFormat::from_path(Path::new("a.jpg")),
            Some(ExportFormat::Jpeg)
        );
        assert_eq!(
            ExportFormat::from_path(Path::new("a.webp")),
            Some(ExportFormat::Webp)
        );
        assert_eq!(ExportFormat::from_path(Path::new("a.gif")), None);
        assert_eq!(ExportFormat::from_path(Path::new("a")), None);
    }

    #[test]
    fn every_format_decodes_again() {
        // A transparent 16 × 16 corner: whole JPEG blocks, so no colour bleeds in.
        let image = RgbaImage::from_fn(40, 20, |x, y| {
            if x < 16 && y < 16 {
                Rgba([0, 0, 0, 0])
            } else {
                Rgba([200, 30, 30, 255])
            }
        });
        for format in ExportFormat::ALL {
            let bytes = encode(&image, format).unwrap();
            let decoded = image::load_from_memory(&bytes).unwrap().to_rgba8();
            assert_eq!(decoded.dimensions(), (40, 20), "{format:?}");
            let corner = decoded.get_pixel(0, 0).0;
            match format {
                // Transparency becomes white.
                ExportFormat::Jpeg => assert!(corner[..3].iter().all(|&c| c > 230), "{corner:?}"),
                _ => assert_eq!(corner[3], 0, "{format:?}"),
            }
        }
    }

    #[test]
    fn files_are_named_after_the_title() {
        assert_eq!(file_stem(&item("Login: Fehler? <neu>")), "Login Fehler neu");
        assert_eq!(file_stem(&item("Bericht...  ")), "Bericht");
        assert_eq!(file_stem(&item(&"x".repeat(300))).len(), MAX_STEM);
        assert!(file_stem(&item("  ")).starts_with("Screenshot 20"));
    }

    #[test]
    fn exports_replace_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        let library = testing::seed(&dir.path().join("library"), 1).unwrap();
        let id = library.list_page(&Default::default(), 0, 1).unwrap()[0].id;
        let target = dir.path().join("out.webp");
        fs::write(&target, b"old").unwrap();
        export(&library, id, &target, ExportFormat::Webp).unwrap();
        assert!(image::open(&target).is_ok());
        assert!(!dir.path().join("out.webp.partial").exists());

        let dragged =
            export_into(&library, id, &dir.path().join("drag"), ExportFormat::Png).unwrap();
        assert_eq!(dragged.extension().unwrap(), "png");
        assert!(dragged.is_file());
    }
}
