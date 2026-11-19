//! Exporting the whole library in a form any software or agent understands
//! (ADR 0013): images with readable names and their title, tags and date in
//! XMP, a JSON and a CSV listing, and a README that explains it all.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Local, SecondsFormat, Utc};
use serde::Serialize;

use crate::Result;
use crate::error::IoContext;
use crate::library::{ASSETS, DOCUMENT, Library, LibraryItem, ListQuery};

/// Names this layout, so importers can recognise it and future ones differ.
pub const FORMAT: &str = "zwopp-export/1";
/// Items read from the library at a time.
const PAGE: u32 = 1000;
/// Longest file name stem, so paths stay well within OS limits.
const MAX_STEM: usize = 80;

/// Where the export went and how many screenshots it holds.
#[derive(Debug, Clone, Serialize)]
pub struct LibraryExport {
    pub dir: PathBuf,
    pub count: usize,
}

/// One screenshot in `screenshots.json` and `screenshots.csv`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    title: String,
    tags: Vec<String>,
    favorite: bool,
    app: Option<String>,
    created_at: String,
    updated_at: String,
    width: u32,
    height: u32,
    /// "screenshot" or "gif".
    kind: &'static str,
    annotated: bool,
    /// Relative to the export folder: the image as shown in Zwopp.
    image: String,
    /// The untouched capture, for annotated screenshots.
    original: Option<String>,
    /// Zwopp's annotations as vectors (docs/spec/document-format.md).
    annotations: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Listing<'a> {
    format: &'static str,
    exported_at: String,
    exported_by: &'a str,
    count: usize,
    screenshots: &'a [Entry],
}

/// Exports every screenshot of `library` into a new folder in `parent`
/// ("Zwopp-Export 2026-11-19", numbered if it exists). `exported_by` names the
/// app and version; `progress` gets (done, total).
pub fn export_library(
    library: &Library,
    parent: &Path,
    exported_by: &str,
    mut progress: impl FnMut(usize, usize),
) -> Result<LibraryExport> {
    let dir = new_dir(parent)?;
    for sub in ["images", "originals", "annotations"] {
        fs::create_dir_all(dir.join(sub)).at(dir.join(sub))?;
    }
    let total = library.count(&ListQuery::default())? as usize;
    let mut names = HashSet::new();
    let mut entries = Vec::with_capacity(total);
    let mut offset = 0;
    loop {
        let page = library.list_page(&ListQuery::default(), offset, PAGE)?;
        if page.is_empty() {
            break;
        }
        offset += page.len() as u64;
        for item in page {
            entries.push(export_item(library, &item, &dir, &mut names)?);
            progress(entries.len(), total);
        }
    }
    // Oldest first, like a camera roll.
    entries.reverse();
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let listing = Listing {
        format: FORMAT,
        exported_at: now,
        exported_by,
        count: entries.len(),
        screenshots: &entries,
    };
    write(
        &dir.join("screenshots.json"),
        &serde_json::to_vec_pretty(&listing)?,
    )?;
    write(&dir.join("screenshots.csv"), csv(&entries).as_bytes())?;
    write(
        &dir.join("README.md"),
        readme(exported_by, entries.len()).as_bytes(),
    )?;
    // Leave out what stayed empty.
    for sub in ["originals", "annotations"] {
        let _ = fs::remove_dir(dir.join(sub));
    }
    Ok(LibraryExport {
        dir,
        count: entries.len(),
    })
}

fn export_item(
    library: &Library,
    item: &LibraryItem,
    dir: &Path,
    names: &mut HashSet<String>,
) -> Result<Entry> {
    let name = unique_name(item, names);
    let animated = item.animation_path.is_some();
    let annotated = item.has_annotations && !animated;
    let (image, source) = match (&item.animation_path, &item.render_path) {
        (Some(gif), _) => (format!("images/{name}.gif"), gif.clone()),
        (None, Some(render)) => (format!("images/{name}.png"), render.clone()),
        (None, None) => (format!("images/{name}.png"), item.original_path.clone()),
    };
    if animated {
        copy(&source, &dir.join(&image))?;
    } else {
        let png = fs::read(&source).at(&source)?;
        write(&dir.join(&image), &with_xmp(&png, &xmp(item)))?;
    }

    let original = if annotated {
        let path = format!("originals/{name}.png");
        copy(&item.original_path, &dir.join(&path))?;
        Some(path)
    } else {
        None
    };

    let item_dir = library.existing_dir(item.id)?;
    let document = item_dir.join(DOCUMENT);
    let annotations = if document.is_file() {
        let path = format!("annotations/{name}.json");
        copy(&document, &dir.join(&path))?;
        // Pasted images the annotations refer to.
        let assets = item_dir.join(ASSETS);
        if assets.is_dir() {
            let target = dir.join("annotations").join(format!("{name}.assets"));
            fs::create_dir_all(&target).at(&target)?;
            for asset in fs::read_dir(&assets).at(&assets)?.flatten() {
                copy(&asset.path(), &target.join(asset.file_name()))?;
            }
        }
        Some(path)
    } else {
        None
    };

    Ok(Entry {
        id: item.id.to_string(),
        title: item.title.clone(),
        tags: item.tags.clone(),
        favorite: item.favorite,
        app: item.app.clone(),
        created_at: item.created_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        updated_at: item.updated_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        width: item.width,
        height: item.height,
        kind: if animated { "gif" } else { "screenshot" },
        annotated,
        image,
        original,
        annotations,
    })
}

/// "2026-11-03 17-10-05 Login error": the local time (sorts by date), then the
/// title; numbered if taken. Characters Windows or macOS do not allow are left out.
fn unique_name(item: &LibraryItem, names: &mut HashSet<String>) -> String {
    let date = item
        .created_at
        .with_timezone(&Local)
        .format("%Y-%m-%d %H-%M-%S")
        .to_string();
    let title: String = item
        .title
        .chars()
        .filter(|c| !c.is_control() && !r#"<>:"/\|?*"#.contains(*c))
        .take(MAX_STEM)
        .collect();
    let title = title.trim().trim_end_matches('.').trim_end();
    let base = if title.is_empty() {
        date
    } else {
        format!("{date} {title}")
    };
    let mut name = base.clone();
    let mut n = 2;
    // File systems may ignore case.
    while !names.insert(name.to_lowercase()) {
        name = format!("{base} ({n})");
        n += 1;
    }
    name
}

/// Title, tags, date and favorite as XMP (Dublin Core and XMP basic), which
/// photo and asset managers read on import.
fn xmp(item: &LibraryItem) -> String {
    let mut fields = String::new();
    if !item.title.is_empty() {
        fields.push_str(&format!(
            "<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">{}</rdf:li></rdf:Alt></dc:title>",
            escape(&item.title)
        ));
    }
    if !item.tags.is_empty() {
        let tags: String = item
            .tags
            .iter()
            .map(|tag| format!("<rdf:li>{}</rdf:li>", escape(tag)))
            .collect();
        fields.push_str(&format!(
            "<dc:subject><rdf:Bag>{tags}</rdf:Bag></dc:subject>"
        ));
    }
    if let Some(app) = &item.app {
        fields.push_str(&format!(
            "<dc:source>{}</dc:source>",
            escape(&format!("Screenshot of {app}"))
        ));
    }
    if item.favorite {
        fields.push_str("<xmp:Rating>5</xmp:Rating>");
    }
    format!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\
         <x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF \
         xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\
         <rdf:Description rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
         xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\">\
         <xmp:CreateDate>{}</xmp:CreateDate><xmp:ModifyDate>{}</xmp:ModifyDate>\
         <xmp:CreatorTool>Zwopp</xmp:CreatorTool>{fields}\
         </rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>",
        item.created_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        item.updated_at.to_rfc3339_opts(SecondsFormat::Secs, true),
    )
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// `png` with an XMP packet in an iTXt chunk right after the header, where
/// readers look for it. Anything that is not a PNG stays as it is.
fn with_xmp(png: &[u8], xmp: &str) -> Vec<u8> {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    // Signature, then IHDR: length (4), type (4), 13 bytes of data, CRC (4).
    let after_header = SIGNATURE.len() + 4 + 4 + 13 + 4;
    if png.len() < after_header || !png.starts_with(SIGNATURE) || &png[12..16] != b"IHDR" {
        return png.to_vec();
    }
    let mut data = b"XML:com.adobe.xmp\0".to_vec();
    // Not compressed, no language, no translated keyword.
    data.extend_from_slice(&[0, 0, 0, 0]);
    data.extend_from_slice(xmp.as_bytes());
    let mut chunk = Vec::with_capacity(data.len() + 12);
    chunk.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut crc = crc32fast::Hasher::new();
    crc.update(b"iTXt");
    crc.update(&data);
    chunk.extend_from_slice(b"iTXt");
    chunk.extend_from_slice(&data);
    chunk.extend_from_slice(&crc.finalize().to_be_bytes());

    let mut out = Vec::with_capacity(png.len() + chunk.len());
    out.extend_from_slice(&png[..after_header]);
    out.extend_from_slice(&chunk);
    out.extend_from_slice(&png[after_header..]);
    out
}

/// The listing as CSV (RFC 4180), for spreadsheets. It starts with a UTF-8
/// byte order mark, without which Excel shows umlauts wrong.
fn csv(entries: &[Entry]) -> String {
    let field = |text: &str| {
        if text.contains([',', '"', '\n', '\r']) {
            format!("\"{}\"", text.replace('"', "\"\""))
        } else {
            text.to_owned()
        }
    };
    let mut out = String::from(
        "\u{feff}id,title,tags,favorite,app,created_at,updated_at,width,height,kind,annotated,image,original,annotations\r\n",
    );
    for e in entries {
        let row = [
            e.id.clone(),
            field(&e.title),
            field(&e.tags.join("; ")),
            e.favorite.to_string(),
            field(e.app.as_deref().unwrap_or("")),
            e.created_at.clone(),
            e.updated_at.clone(),
            e.width.to_string(),
            e.height.to_string(),
            e.kind.to_owned(),
            e.annotated.to_string(),
            field(&e.image),
            field(e.original.as_deref().unwrap_or("")),
            field(e.annotations.as_deref().unwrap_or("")),
        ];
        out.push_str(&row.join(","));
        out.push_str("\r\n");
    }
    out
}

fn readme(exported_by: &str, count: usize) -> String {
    format!(
        "# Zwopp export\n\n\
         {count} screenshots, exported by {exported_by} on {date}. Format: `{FORMAT}`.\n\n\
         Everything here is in common formats; no Zwopp is needed to use it.\n\n\
         | Path | Contents |\n|---|---|\n\
         | `images/` | Every screenshot as shown in Zwopp (with its annotations), named \
         `<date> <time> <title>`. PNG files carry title, tags, date and favorite (as 5-star \
         rating) as XMP metadata, which photo and asset managers read on import. Recordings \
         are animated GIFs. |\n\
         | `originals/` | The untouched captures of annotated screenshots. |\n\
         | `annotations/` | Zwopp's annotations as vectors (JSON, see \
         https://github.com/cwecode/zwopp/blob/main/docs/spec/document-format.md); \
         `<name>.assets/` holds images pasted into them. |\n\
         | `screenshots.json` | All screenshots with every field, oldest first. |\n\
         | `screenshots.csv` | The same as a table (UTF-8, comma-separated, tags separated by `; `). |\n\n\
         ## Fields\n\n\
         | Field | |\n|---|---|\n\
         | `id` | Zwopp's id of the screenshot |\n\
         | `title`, `tags`, `favorite` | As set in Zwopp |\n\
         | `app` | The application the screenshot was taken in, if known |\n\
         | `createdAt`, `updatedAt` | ISO 8601, UTC |\n\
         | `width`, `height` | Pixels |\n\
         | `kind` | `screenshot` or `gif` |\n\
         | `annotated` | Edited in Zwopp's editor |\n\
         | `image`, `original`, `annotations` | Paths relative to this folder |\n",
        date = Local::now().format("%Y-%m-%d %H:%M"),
    )
}

/// A new folder "Zwopp-Export <date>" in `parent`, numbered if it exists.
fn new_dir(parent: &Path) -> Result<PathBuf> {
    let base = format!("Zwopp-Export {}", Local::now().format("%Y-%m-%d"));
    let mut dir = parent.join(&base);
    let mut n = 2;
    while dir.exists() {
        dir = parent.join(format!("{base} ({n})"));
        n += 1;
    }
    fs::create_dir_all(&dir).at(&dir)?;
    Ok(dir)
}

fn copy(from: &Path, to: &Path) -> Result<()> {
    fs::copy(from, to).at(from)?;
    Ok(())
}

fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    fs::write(path, bytes).at(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::ItemUpdate;
    use image::{Rgba, RgbaImage};

    #[test]
    fn exports_everything_readably() {
        let root = tempfile::tempdir().unwrap();
        let library = Library::open(root.path().join("library")).unwrap();
        let first = library
            .add_from(&RgbaImage::new(4, 3), Some("Firefox"))
            .unwrap();
        library
            .update(
                first.id,
                ItemUpdate {
                    title: Some("Login: error <b>".into()),
                    tags: Some(vec!["bug".into(), "a, b".into()]),
                    favorite: Some(true),
                },
            )
            .unwrap();
        // An annotated one: render, document and an asset.
        let second = library
            .add(&RgbaImage::from_pixel(2, 2, Rgba([9, 9, 9, 255])))
            .unwrap();
        library
            .save_document(
                second.id,
                &serde_json::json!({ "schemaVersion": 1, "objects": [] }),
            )
            .unwrap();
        let mut png = Vec::new();
        RgbaImage::new(2, 2)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        library.save_render(second.id, &png).unwrap();
        // A GIF recording.
        let mut gif = crate::record::GifRecorder::new(2, 2).unwrap();
        gif.push(&RgbaImage::new(2, 2), 0).unwrap();
        let gif = gif.finish(100).unwrap();
        library
            .add_animation(&gif, &RgbaImage::new(2, 2), None)
            .unwrap();

        let out = root.path().join("out");
        fs::create_dir_all(&out).unwrap();
        let mut seen = 0;
        let export = export_library(&library, &out, "Zwopp 9.9", |done, total| {
            assert_eq!(total, 3);
            seen = done;
        })
        .unwrap();
        assert_eq!((export.count, seen), (3, 3));
        assert!(
            export
                .dir
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("Zwopp-Export ")
        );

        let listing: serde_json::Value =
            serde_json::from_slice(&fs::read(export.dir.join("screenshots.json")).unwrap())
                .unwrap();
        assert_eq!(listing["format"], FORMAT);
        let shots = listing["screenshots"].as_array().unwrap();
        assert_eq!(shots.len(), 3);
        for shot in shots {
            assert!(export.dir.join(shot["image"].as_str().unwrap()).is_file());
        }
        let titled = shots
            .iter()
            .find(|s| s["title"] == "Login: error <b>")
            .unwrap();
        assert!(
            titled["image"]
                .as_str()
                .unwrap()
                .ends_with(" Login error b.png")
        );
        assert_eq!(titled["app"], "Firefox");
        let edited = shots.iter().find(|s| s["annotated"] == true).unwrap();
        assert!(
            export
                .dir
                .join(edited["original"].as_str().unwrap())
                .is_file()
        );
        assert!(
            export
                .dir
                .join(edited["annotations"].as_str().unwrap())
                .is_file()
        );
        let recording = shots.iter().find(|s| s["kind"] == "gif").unwrap();
        assert!(recording["image"].as_str().unwrap().ends_with(".gif"));

        // The PNG still decodes and carries the XMP, escaped.
        let image_path = export.dir.join(titled["image"].as_str().unwrap());
        assert_eq!(image::open(&image_path).unwrap().width(), 4);
        let bytes = fs::read(&image_path).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("XML:com.adobe.xmp"));
        assert!(text.contains("Login: error &lt;b&gt;"));
        assert!(text.contains("<rdf:li>a, b</rdf:li>"));
        assert!(text.contains("<xmp:Rating>5</xmp:Rating>"));

        let csv = fs::read_to_string(export.dir.join("screenshots.csv")).unwrap();
        // Tags come sorted from the library; a comma in one quotes the field.
        assert!(csv.contains("\"a, b; bug\""));
        assert!(export.dir.join("README.md").is_file());

        // A second export goes into a new folder.
        let again = export_library(&library, &out, "Zwopp 9.9", |_, _| {}).unwrap();
        assert_ne!(again.dir, export.dir);
    }

    #[test]
    fn names_are_unique_and_safe() {
        let root = tempfile::tempdir().unwrap();
        let library = Library::open(root.path()).unwrap();
        let item = library.add(&RgbaImage::new(1, 1)).unwrap();
        let mut names = HashSet::new();
        let a = unique_name(&item, &mut names);
        let b = unique_name(&item, &mut names);
        assert_eq!(b, format!("{a} (2)"));
        assert!(!a.contains(':'));
    }
}
