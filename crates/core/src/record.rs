//! Recordings of a screen region over time: a panorama of content scrolled
//! through the region, and animated GIFs of click sequences.
//!
//! Both are fed frames of the same region (see `capture::capture_region`);
//! the capture loop lives in the app, everything here is plain image work.

use std::hash::{DefaultHasher, Hash, Hasher};

use gif::{DisposalMethod, Encoder, Frame, Repeat};
use image::{Rgba, RgbaImage};

use crate::Result;

/// The tallest panorama, in pixels; the editor's canvas allows little more.
pub const MAX_PANORAMA_HEIGHT: u32 = 30_000;
/// The longest GIF recording.
pub const MAX_GIF_SECONDS: u64 = 60;

/// What a frame did to a [`Panorama`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// New content below what was there; this many rows.
    Added(u32),
    /// Nothing scrolled.
    Same,
    /// No overlap with the last frame: scrolled too far at once, or up.
    Lost,
    /// [`MAX_PANORAMA_HEIGHT`] is reached.
    Full,
}

/// The overlap that has to match, at least: this many rows, or an eighth of
/// the scrolling part.
const MIN_OVERLAP: usize = 8;
/// Share of overlapping rows that has to match (in tenths); a little slack
/// for content that changes while scrolling, e.g. a hover effect.
const MATCHING_TENTHS: usize = 9;
/// Rows with more than one colour that have to match, so a shift is not
/// found in blank space alone.
const MIN_DISTINCT_ROWS: usize = 4;

/// Joins frames of a region that is scrolled down into one tall image.
///
/// Each frame is compared with the last one that was used, row by row: rows
/// that stay in place at the top and bottom (a fixed header or footer) are
/// kept once, and in between the shift is found where the rows match again.
/// The rows that came in at the bottom are added.
pub struct Panorama {
    width: u32,
    /// The joined image, RGBA rows.
    pixels: Vec<u8>,
    /// Rows at the end of `pixels` that stay in every frame; new rows go above.
    footer: Option<usize>,
    /// Rows of the last used frame.
    last: Vec<Row>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Row {
    hash: u64,
    /// All pixels have the same colour.
    plain: bool,
}

impl Row {
    fn same(&self, other: &Row) -> bool {
        self.hash == other.hash
    }
}

fn rows(frame: &RgbaImage) -> Vec<Row> {
    let stride = frame.width() as usize * 4;
    frame
        .as_raw()
        .chunks_exact(stride)
        .map(|row| {
            let mut hasher = DefaultHasher::new();
            row.hash(&mut hasher);
            Row {
                hash: hasher.finish(),
                plain: row.as_chunks::<4>().0.iter().all(|p| p[..] == row[..4]),
            }
        })
        .collect()
}

impl Panorama {
    pub fn new(first: &RgbaImage) -> Self {
        Self {
            width: first.width(),
            pixels: first.as_raw().clone(),
            footer: None,
            last: rows(first),
        }
    }

    /// The height joined so far.
    pub fn height(&self) -> u32 {
        (self.pixels.len() / (self.width as usize * 4)) as u32
    }

    pub fn push(&mut self, frame: &RgbaImage) -> Step {
        let rows = rows(frame);
        if frame.width() != self.width || rows.len() != self.last.len() || rows == self.last {
            return Step::Same;
        }
        if self.height() >= MAX_PANORAMA_HEIGHT {
            return Step::Full;
        }
        let height = rows.len();
        let top = rows
            .iter()
            .zip(&self.last)
            .take_while(|(a, b)| a.same(b))
            .count();
        let bottom = rows
            .iter()
            .rev()
            .zip(self.last.iter().rev())
            .take_while(|(a, b)| a.same(b))
            .count();
        // Only a part in between changed; with nothing scrolled that can be
        // anything (a blinking cursor), so it counts as no change.
        let band = height.saturating_sub(top + bottom);
        let Some(shift) = self.shift(&rows, top, band) else {
            return Step::Lost;
        };

        let stride = self.width as usize * 4;
        let footer = self.footer.map_or(bottom, |footer| footer.min(bottom));
        self.footer = Some(footer);
        let room = MAX_PANORAMA_HEIGHT.saturating_sub(self.height()) as usize;
        let added = shift.min(room);
        let start = (height - bottom - shift) * stride;
        let new_rows = &frame.as_raw()[start..start + added * stride];
        let at = self.pixels.len() - footer * stride;
        self.pixels.splice(at..at, new_rows.iter().copied());
        self.last = rows;
        Step::Added(added as u32)
    }

    /// How far the part from row `top` (`band` rows) moved up since the last
    /// frame: the smallest shift with the most matching rows.
    fn shift(&self, rows: &[Row], top: usize, band: usize) -> Option<usize> {
        let min_overlap = MIN_OVERLAP.max(band / 8);
        let mut best: Option<(usize, usize)> = None;
        for shift in 1..band {
            let overlap = band - shift;
            if overlap < min_overlap {
                break;
            }
            let (mut matching, mut distinct) = (0, 0);
            let earlier = &self.last[top + shift..];
            for (row, before) in rows[top..top + overlap].iter().zip(earlier) {
                if row.same(before) {
                    matching += 1;
                    distinct += usize::from(!row.plain);
                }
            }
            if matching * 10 >= overlap * MATCHING_TENTHS
                && distinct >= MIN_DISTINCT_ROWS
                && best.is_none_or(|(_, most)| distinct > most)
            {
                best = Some((shift, distinct));
            }
        }
        best.map(|(shift, _)| shift)
    }

    pub fn finish(self) -> RgbaImage {
        let height = self.height();
        RgbaImage::from_raw(self.width, height, self.pixels).expect("the panorama holds whole rows")
    }
}

/// GIF speed (1–30): lower picks better colours, but takes longer per frame.
const GIF_SPEED: i32 = 10;

/// Writes frames of a region as an endlessly looping GIF. Each frame only
/// stores the rectangle that changed, so a recording of clicks in a mostly
/// still window stays small; identical frames just lengthen the one before.
pub struct GifRecorder {
    encoder: Encoder<Vec<u8>>,
    /// The region as the GIF shows it after the last written frame.
    screen: Option<RgbaImage>,
    /// The latest frame, written once its duration is known.
    pending: Option<(Frame<'static>, u64)>,
}

impl GifRecorder {
    pub fn new(width: u32, height: u32) -> Result<Self> {
        let mut encoder = Encoder::new(Vec::new(), width as u16, height as u16, &[])?;
        encoder.set_repeat(Repeat::Infinite)?;
        Ok(Self {
            encoder,
            screen: None,
            pending: None,
        })
    }

    /// Adds `frame`, shown from `ms` milliseconds after the start.
    pub fn push(&mut self, frame: &RgbaImage, ms: u64) -> Result<()> {
        let changed = match &self.screen {
            None => Some((0, 0, frame.width(), frame.height())),
            Some(screen) => changed_area(screen, frame),
        };
        let Some((x, y, width, height)) = changed else {
            return Ok(());
        };
        let mut part = image::imageops::crop_imm(frame, x, y, width, height)
            .to_image()
            .into_raw();
        let mut gif_frame =
            Frame::from_rgba_speed(width as u16, height as u16, &mut part, GIF_SPEED);
        gif_frame.left = x as u16;
        gif_frame.top = y as u16;
        gif_frame.dispose = DisposalMethod::Keep;
        self.write_pending(ms)?;
        self.pending = Some((gif_frame, ms));
        self.screen = Some(frame.clone());
        Ok(())
    }

    /// The GIF, with the last frame shown until `ms`.
    pub fn finish(mut self, ms: u64) -> Result<Vec<u8>> {
        self.write_pending(ms)?;
        Ok(self.encoder.into_inner()?)
    }

    fn write_pending(&mut self, until: u64) -> Result<()> {
        if let Some((mut frame, since)) = self.pending.take() {
            // In hundredths of a second; browsers show shorter delays slower.
            frame.delay =
                ((until.saturating_sub(since) / 10).max(2)).min(u64::from(u16::MAX)) as u16;
            self.encoder.write_frame(&frame)?;
        }
        Ok(())
    }
}

/// The rectangle (x, y, width, height) in which `a` and `b` differ, if they do.
fn changed_area(a: &RgbaImage, b: &RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let width = a.width() as usize;
    let stride = width * 4;
    let (a, b) = (a.as_raw(), b.as_raw());
    let rows: Vec<usize> = (0..a.len() / stride)
        .filter(|&row| a[row * stride..][..stride] != b[row * stride..][..stride])
        .collect();
    let (&first, &last) = (rows.first()?, rows.last()?);
    let (mut left, mut right) = (width, 0);
    for &row in &rows {
        let (ra, rb) = (&a[row * stride..][..stride], &b[row * stride..][..stride]);
        let differs = |x: &usize| ra[x * 4..x * 4 + 4] != rb[x * 4..x * 4 + 4];
        if let Some(x) = (0..left).find(differs) {
            left = x;
        }
        if let Some(x) = (right..width).rev().find(differs) {
            right = x;
        }
    }
    Some((
        left as u32,
        first as u32,
        (right.max(left) - left + 1) as u32,
        (last - first + 1) as u32,
    ))
}

/// The arrow of the mouse pointer: `#` outline, `o` fill.
const POINTER: [&str; 19] = [
    "#",
    "##",
    "#o#",
    "#oo#",
    "#ooo#",
    "#oooo#",
    "#ooooo#",
    "#oooooo#",
    "#ooooooo#",
    "#oooooooo#",
    "#ooooooooo#",
    "#oooooo#####",
    "#ooo#oo#",
    "#oo# #oo#",
    "#o#  #oo#",
    "##    #oo#",
    "#     #oo#",
    "       #oo#",
    "        ##",
];

/// Draws the mouse pointer with its tip at (`x`, `y`), `scale` times the
/// size of the usual arrow; `pressed` puts a yellow ring around the tip, so a
/// click shows in a recording.
pub fn draw_pointer(frame: &mut RgbaImage, x: i32, y: i32, scale: u32, pressed: bool) {
    let scale = scale.max(1) as i32;
    if pressed {
        let radius = 14 * scale;
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                let distance = ((dx * dx + dy * dy) as f32).sqrt();
                if distance <= radius as f32 {
                    // A ring that fades towards the middle.
                    let alpha = 0.25 + 0.45 * (distance / radius as f32);
                    blend(frame, x + dx, y + dy, Rgba([255, 200, 0, 255]), alpha);
                }
            }
        }
    }
    for (row, line) in POINTER.iter().enumerate() {
        for (column, c) in line.chars().enumerate() {
            let color = match c {
                '#' => Rgba([0, 0, 0, 255]),
                'o' => Rgba([255, 255, 255, 255]),
                _ => continue,
            };
            for sy in 0..scale {
                for sx in 0..scale {
                    let px = x + column as i32 * scale + sx;
                    let py = y + row as i32 * scale + sy;
                    blend(frame, px, py, color, 1.0);
                }
            }
        }
    }
}

fn blend(frame: &mut RgbaImage, x: i32, y: i32, color: Rgba<u8>, alpha: f32) {
    if x < 0 || y < 0 || x >= frame.width() as i32 || y >= frame.height() as i32 {
        return;
    }
    let pixel = frame.get_pixel_mut(x as u32, y as u32);
    for i in 0..3 {
        let mixed = f32::from(pixel.0[i]) * (1.0 - alpha) + f32::from(color.0[i]) * alpha;
        pixel.0[i] = mixed.round() as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A page of `height` rows where every row looks different.
    fn page(width: u32, height: u32) -> RgbaImage {
        RgbaImage::from_fn(width, height, |x, y| {
            Rgba([(y % 251) as u8, (y / 251) as u8, (x * 7 % 256) as u8, 255])
        })
    }

    /// What a region of `height` rows shows of `page` scrolled down by
    /// `scroll`, with a fixed header and footer of `fixed` rows each.
    fn view(page: &RgbaImage, scroll: u32, height: u32, fixed: u32) -> RgbaImage {
        RgbaImage::from_fn(page.width(), height, |x, y| {
            if y < fixed {
                Rgba([255, 0, 0, 255])
            } else if y >= height - fixed {
                Rgba([0, 0, 255, if x % 2 == 0 { 255 } else { 254 }])
            } else {
                *page.get_pixel(x, scroll + y)
            }
        })
    }

    #[test]
    fn scrolled_frames_join_into_the_page() {
        let page = page(20, 400);
        let mut panorama = Panorama::new(&view(&page, 0, 100, 0));
        assert_eq!(panorama.push(&view(&page, 0, 100, 0)), Step::Same);
        for scroll in [30, 70, 150, 230, 300] {
            assert!(matches!(
                panorama.push(&view(&page, scroll, 100, 0)),
                Step::Added(_)
            ));
        }
        assert_eq!(panorama.finish(), page);
    }

    #[test]
    fn fixed_header_and_footer_appear_once() {
        let page = page(20, 400);
        let mut panorama = Panorama::new(&view(&page, 0, 100, 10));
        for scroll in (20..=300).step_by(20) {
            panorama.push(&view(&page, scroll, 100, 10));
        }
        let joined = panorama.finish();
        // Header, the page from row 10 to 390 (where the last view ends), footer.
        assert_eq!(joined.height(), 10 + 380 + 10);
        assert_eq!(joined.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(joined.get_pixel(0, 10), page.get_pixel(0, 10));
        assert_eq!(joined.get_pixel(0, 389), page.get_pixel(0, 389));
        assert_eq!(joined.get_pixel(0, 399).0, [0, 0, 255, 255]);
    }

    #[test]
    fn a_jump_without_overlap_is_lost() {
        let page = page(20, 400);
        let mut panorama = Panorama::new(&view(&page, 0, 100, 0));
        assert_eq!(panorama.push(&view(&page, 200, 100, 0)), Step::Lost);
        // Back within reach, it goes on.
        assert_eq!(panorama.push(&view(&page, 50, 100, 0)), Step::Added(50));
        assert_eq!(panorama.height(), 150);
    }

    #[test]
    fn gif_frames_store_only_what_changed() {
        let still = RgbaImage::from_pixel(40, 30, Rgba([200, 200, 200, 255]));
        let mut clicked = still.clone();
        draw_pointer(&mut clicked, 10, 5, 1, true);
        let mut gif = GifRecorder::new(40, 30).unwrap();
        gif.push(&still, 0).unwrap();
        gif.push(&still, 100).unwrap();
        gif.push(&clicked, 500).unwrap();
        let bytes = gif.finish(900).unwrap();

        let mut options = gif::DecodeOptions::new();
        options.set_color_output(gif::ColorOutput::RGBA);
        let mut decoder = options.read_info(bytes.as_slice()).unwrap();
        let mut frames = Vec::new();
        while let Some(frame) = decoder.read_next_frame().unwrap() {
            frames.push((
                frame.left,
                frame.top,
                frame.width,
                frame.height,
                frame.delay,
            ));
        }
        // The still frame twice is one frame of 0.5 s; the click only redraws around it.
        assert_eq!(frames[0], (0, 0, 40, 30, 50));
        let (left, top, width, height, delay) = frames[1];
        assert_eq!(delay, 40);
        assert!(width < 40 && height < 30, "{frames:?}");
        assert!(left <= 10 && top <= 5);
        assert_eq!(frames.len(), 2);
    }

    #[test]
    fn changed_area_is_tight() {
        let a = RgbaImage::new(10, 10);
        let mut b = a.clone();
        assert_eq!(changed_area(&a, &b), None);
        b.put_pixel(2, 3, Rgba([1, 0, 0, 0]));
        b.put_pixel(6, 7, Rgba([1, 0, 0, 0]));
        assert_eq!(changed_area(&a, &b), Some((2, 3, 5, 5)));
    }
}
