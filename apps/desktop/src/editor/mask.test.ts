import { describe, expect, it } from "vitest";
import { decodeMask, encodeMask, floodFill, isMask, maskArea, maskBitmap, type Mask } from "./mask";

/** An image from rows of characters: "." white, "#" black, "r" red. */
function image(rows: string[]) {
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * rows.length * 4);
  const colors: Record<string, number[]> = { ".": [255, 255, 255, 255], "#": [0, 0, 0, 255], r: [250, 0, 0, 255] };
  rows.forEach((row, y) => [...row].forEach((c, x) => data.set(colors[c], (y * width + x) * 4)));
  return { data, width, height: rows.length };
}

const pixels = (mask: Mask) => {
  const { bits, width } = decodeMask(mask);
  return [...bits].flatMap((bit, i) => (bit ? [[mask.x + (i % width), mask.y + Math.floor(i / width)]] : []));
};

describe("floodFill", () => {
  const ring = image([
    ".....", //
    ".###.",
    ".#.#.",
    ".###.",
    ".....",
  ]);

  it("fills the connected area of one colour only", () => {
    const inner = encodeMask(floodFill(ring.data, ring.width, ring.height, 2, 2, 8)!)!;
    expect(pixels(inner)).toEqual([[2, 2]]);
    const outer = encodeMask(floodFill(ring.data, ring.width, ring.height, 0, 0, 8)!)!;
    expect(maskArea(outer)).toBe(16);
    expect(outer).toMatchObject({ x: 0, y: 0, width: 5, height: 5 });
    const frame = encodeMask(floodFill(ring.data, ring.width, ring.height, 1, 1, 8)!)!;
    expect(maskArea(frame)).toBe(8);
  });

  it("takes similar colours within the tolerance", () => {
    const img = image(["rr#", "r.."]);
    // Red next to black: within 32 of (250,0,0) is only red.
    expect(maskArea(encodeMask(floodFill(img.data, img.width, img.height, 0, 0, 32)!)!)).toBe(3);
    expect(maskArea(encodeMask(floodFill(img.data, img.width, img.height, 0, 0, 255)!)!)).toBe(6);
  });

  it("ignores points outside the image", () => {
    expect(floodFill(ring.data, ring.width, ring.height, -1, 0, 8)).toBeNull();
    expect(floodFill(ring.data, ring.width, ring.height, 5, 0, 8)).toBeNull();
  });

  it("handles large areas without running out of stack", () => {
    const size = 1000;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    const mask = encodeMask(floodFill(data, size, size, 500, 500, 0)!)!;
    expect(maskArea(mask)).toBe(size * size);
    // One colour compresses to a single run.
    expect(mask.runs).toEqual([0, size * size]);
  });
});

describe("masks", () => {
  const mask: Mask = { x: 2, y: 1, width: 3, height: 2, runs: [1, 2, 1, 1, 1] };

  it("round-trip through bitmaps", () => {
    expect(pixels(mask)).toEqual([
      [3, 1],
      [4, 1],
      [3, 2],
    ]);
    expect(encodeMask(decodeMask(mask))).toEqual({ x: 3, y: 1, width: 2, height: 2, runs: [0, 3, 1] });
    expect(encodeMask({ x: 0, y: 0, width: 2, height: 2, bits: new Uint8Array(4) })).toBeNull();
  });

  it("combine and invert in an area", () => {
    const area = { x: 2, y: 1, width: 3, height: 2 };
    expect([...maskBitmap([mask], area).bits]).toEqual([0, 1, 1, 0, 1, 0]);
    expect([...maskBitmap([mask], area, true).bits]).toEqual([1, 0, 0, 1, 0, 1]);
  });

  it("are validated when read", () => {
    expect(isMask(mask)).toBe(true);
    expect(isMask({ ...mask, runs: [1, 2] })).toBe(false);
    expect(isMask({ ...mask, width: -3 })).toBe(false);
    expect(isMask(null)).toBe(false);
  });
});
