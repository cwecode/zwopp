// Pixel masks for the magic wand and the fill bucket: which pixels of the
// screenshot belong to an area of similar colour. Stored run-length encoded,
// so a mask over a large area of one colour stays small in document.json.

import type { Rect } from "./document";

/**
 * A set of pixels inside `x, y, width, height` (image pixels). `runs` are run
 * lengths row by row, left to right, alternating outside / inside and starting
 * with outside (which may be 0).
 */
export interface Mask extends Rect {
  runs: number[];
}

/** Colour distance (0–255) up to which the wand and the bucket take a pixel. */
export const TOLERANCES = [8, 32, 64, 96];
export const DEFAULT_TOLERANCE = 1;

/** A mask as one byte per pixel (1 = inside) of its rectangle. */
export interface Bitmap extends Rect {
  bits: Uint8Array;
}

/**
 * The connected area around (sx, sy) whose colours differ from the start
 * pixel by at most `tolerance` in every channel (alpha included), as a
 * bitmap of the whole image. Null if the point is outside the image.
 */
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  tolerance: number,
): Bitmap | null {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  const start = (sy * width + sx) * 4;
  const [r, g, b, a] = [data[start], data[start + 1], data[start + 2], data[start + 3]];
  const matches = (i: number) => {
    const p = i * 4;
    return (
      Math.abs(data[p] - r) <= tolerance &&
      Math.abs(data[p + 1] - g) <= tolerance &&
      Math.abs(data[p + 2] - b) <= tolerance &&
      Math.abs(data[p + 3] - a) <= tolerance
    );
  };
  const bits = new Uint8Array(width * height);
  // Scanline fill: each stack entry is a pixel to grow a horizontal run from.
  const stack = [sy * width + sx];
  while (stack.length) {
    const i = stack.pop()!;
    if (bits[i]) continue;
    const y = Math.floor(i / width);
    let left = i;
    while (left % width > 0 && !bits[left - 1] && matches(left - 1)) left--;
    let right = i;
    while (right % width < width - 1 && !bits[right + 1] && matches(right + 1)) right++;
    bits.fill(1, left, right + 1);
    // One seed per run of matching pixels in the rows above and below.
    for (const dy of [-1, 1]) {
      if (y + dy < 0 || y + dy >= height) continue;
      let open = false;
      for (let p = left; p <= right; p++) {
        const next = p + dy * width;
        const ok = !bits[next] && matches(next);
        if (ok && !open) stack.push(next);
        open = ok;
      }
    }
  }
  return { x: 0, y: 0, width, height, bits };
}

/** Bitmap → mask, cropped to the pixels that are set. Null if none are. */
export function encodeMask(bitmap: Bitmap): Mask | null {
  const { width, height, bits } = bitmap;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!bits[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  const runs: number[] = [];
  let inside = 0;
  let length = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const bit = bits[y * width + x];
      if (bit === inside) {
        length++;
      } else {
        runs.push(length);
        inside = bit;
        length = 1;
      }
    }
  }
  runs.push(length);
  return { x: bitmap.x + x0, y: bitmap.y + y0, width: x1 - x0 + 1, height: y1 - y0 + 1, runs };
}

/** Mask → bitmap of its own rectangle. */
export function decodeMask(mask: Mask): Bitmap {
  const bits = new Uint8Array(mask.width * mask.height);
  let at = 0;
  mask.runs.forEach((length, i) => {
    if (i % 2) bits.fill(1, at, at + length);
    at += length;
  });
  return { x: mask.x, y: mask.y, width: mask.width, height: mask.height, bits };
}

/** A bitmap covering `area` with the given masks' pixels set (or, with `invert`, cleared). */
export function maskBitmap(masks: Mask[], area: Rect, invert = false): Bitmap {
  const bits = new Uint8Array(area.width * area.height).fill(invert ? 1 : 0);
  for (const mask of masks) {
    const own = decodeMask(mask);
    for (let y = 0; y < own.height; y++) {
      const ty = own.y + y - area.y;
      if (ty < 0 || ty >= area.height) continue;
      for (let x = 0; x < own.width; x++) {
        const tx = own.x + x - area.x;
        if (tx < 0 || tx >= area.width || !own.bits[y * own.width + x]) continue;
        bits[ty * area.width + tx] = invert ? 0 : 1;
      }
    }
  }
  return { ...area, bits };
}

/** Number of pixels in a mask. */
export function maskArea(mask: Mask): number {
  return mask.runs.reduce((sum, length, i) => (i % 2 ? sum + length : sum), 0);
}

/** A canvas of the mask's rectangle with its pixels in `color` and the rest transparent. */
export function maskCanvas(mask: Mask, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(mask.width, mask.height);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const { bits } = decodeMask(mask);
  for (let i = 0; i < bits.length; i++) {
    if (!bits[i]) continue;
    pixels.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/** Whether `value` is a well-formed mask (e.g. read from a document). */
export function isMask(value: unknown): value is Mask {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  const whole = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  return (
    Number.isInteger(m.x) &&
    Number.isInteger(m.y) &&
    whole(m.width) &&
    whole(m.height) &&
    Array.isArray(m.runs) &&
    m.runs.every(whole) &&
    m.runs.reduce((sum: number, n: number) => sum + n, 0) === (m.width as number) * (m.height as number)
  );
}
