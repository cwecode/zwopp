import { describe, expect, it } from "vitest";
import { createDocument, eraseMask, imageBounds, loadDocument, penShape, translateShape } from "./document";
import { maskArea, type Mask } from "./mask";
import { sanitizeStyle } from "./quickStyles";
import { stylePatch } from "./tools";

describe("pen", () => {
  it("keeps its points relative to its box", () => {
    const pen = penShape({ id: "p", layer: "l" }, [
      { x: 10, y: 20 },
      { x: 30, y: 60 },
      { x: 20, y: 40 },
    ], "#e5322d", 5);
    expect(pen).toMatchObject({ x: 10, y: 20, width: 20, height: 40 });
    expect(pen.points).toEqual([0, 0, 1, 1, 0.5, 0.5]);
    // Moving only moves the box.
    expect(translateShape(pen, 5, 5)).toMatchObject({ x: 15, y: 25, points: pen.points });
    expect(stylePatch(pen, { color: "#2f80ed", size: 3 })).toEqual({ stroke: "#2f80ed", strokeWidth: 12 });
  });

  it("gives a straight or single-point line a box", () => {
    const flat = penShape({ id: "p", layer: "l" }, [{ x: 5, y: 7 }, { x: 25, y: 7 }], "#000000", 3);
    expect(flat).toMatchObject({ width: 20, height: 1, points: [0, 0, 1, 0] });
    const dot = penShape({ id: "p", layer: "l" }, [{ x: 5, y: 7 }], "#000000", 3);
    expect(dot).toMatchObject({ width: 1, height: 1, points: [0, 0] });
  });
});

describe("magic wand", () => {
  // A 2 × 2 object in the middle of a 10 × 8 screenshot.
  const object: Mask = { x: 4, y: 3, width: 2, height: 2, runs: [0, 4] };

  it("deletes the selected pixels", () => {
    const doc = eraseMask(createDocument(10, 8), object);
    expect(doc.erasedMasks).toEqual([object]);
    expect(imageBounds(doc)).toEqual({ x: 0, y: 0, width: 10, height: 8 });
  });

  it("keeps only the selection and trims the image to it", () => {
    const ring: Mask = { x: 4, y: 3, width: 3, height: 3, runs: [0, 4, 1, 4] };
    const doc = eraseMask(createDocument(10, 8), ring, true);
    expect(imageBounds(doc)).toEqual({ x: 4, y: 3, width: 3, height: 3 });
    // Inside the box, only the hole in the ring is deleted.
    expect(doc.erasedMasks).toHaveLength(1);
    expect(maskArea(doc.erasedMasks![0])).toBe(1);
    expect(doc.erasedMasks![0]).toMatchObject({ x: 5, y: 4, width: 1, height: 1 });
  });

  it("survives saving, and broken masks are dropped", () => {
    const doc = eraseMask(createDocument(10, 8), object);
    const stored = JSON.parse(JSON.stringify({ ...doc, erasedMasks: [...doc.erasedMasks!, { x: 0, y: 0, width: 2, height: 2, runs: [1] }] }));
    expect(loadDocument(stored, 10, 8).erasedMasks).toEqual([object]);
    expect(loadDocument(JSON.parse(JSON.stringify(createDocument(10, 8))), 10, 8).erasedMasks).toBeUndefined();
  });
});

describe("tolerance", () => {
  it("is kept for the bucket and the wand only", () => {
    expect(sanitizeStyle("fill", { tolerance: 3 }).tolerance).toBe(3);
    expect(sanitizeStyle("wand", { tolerance: 9 }).tolerance).toBe(1);
    expect(sanitizeStyle("arrow", { tolerance: 2 }).tolerance).toBeUndefined();
  });
});
