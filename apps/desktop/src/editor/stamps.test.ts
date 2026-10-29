import { describe, expect, it } from "vitest";
import { nextStepNumber, type EditorDocument, type Shape } from "./document";
import { sanitizeStyle, styleFor } from "./quickStyles";
import { STAMP_BOX, STAMP_DRAWINGS, STAMPS } from "./stamps";
import { SIZES, stampSize, stylePatch } from "./tools";

const doc = (objects: Shape[]): EditorDocument => ({
  schemaVersion: 3,
  canvas: { width: 100, height: 100 },
  erased: [],
  layers: [{ id: "l", name: "Original", visible: true, locked: false }],
  objects,
  groups: [],
});

const step = (number: number): Shape => ({
  id: `s${number}`,
  type: "step",
  layer: "l",
  x: 0,
  y: 0,
  width: 20,
  height: 20,
  number,
  fill: "#e5322d",
});

describe("step numbers", () => {
  it("count up, or repeat the highest", () => {
    expect(nextStepNumber(doc([]))).toBe(1);
    expect(nextStepNumber(doc([]), true)).toBe(1);
    expect(nextStepNumber(doc([step(1), step(3), step(2)]))).toBe(4);
    expect(nextStepNumber(doc([step(1), step(3), step(2)]), true)).toBe(3);
  });

  it("keep a fixed number in quick styles, if it is valid", () => {
    expect(sanitizeStyle("step", { number: 2 }).number).toBe(2);
    for (const bad of [0, -1, 1.5, 1000, "2"]) expect(sanitizeStyle("step", { number: bad }).number).toBeUndefined();
    expect(sanitizeStyle("arrow", { number: 2 }).number).toBeUndefined();
    expect(styleFor("step", { color: "#000000", size: 0, number: 7 }).number).toBe(7);
  });
});

describe("mouse stamps", () => {
  it("have a drawing for every kind", () => {
    for (const kind of STAMPS) expect(STAMP_DRAWINGS[kind].fills.length).toBeGreaterThan(0);
  });

  it("keep the mouse's proportions at every size", () => {
    for (const size of SIZES) {
      const { width, height } = stampSize(size);
      expect(width / height).toBeCloseTo(STAMP_BOX.width / STAMP_BOX.height, 1);
    }
  });

  it("follow colour, kind and size around their centre", () => {
    const { width, height } = stampSize(SIZES[1]);
    const stamp: Shape = { id: "m", type: "stamp", layer: "l", x: 100, y: 100, width, height, stamp: "left", fill: "#e5322d" };
    expect(stylePatch(stamp, { color: "#2f80ed", stamp: "scroll" })).toEqual({ fill: "#2f80ed", stamp: "scroll" });
    const bigger = stampSize(SIZES[3]);
    expect(stylePatch(stamp, { size: 3 })).toEqual({
      x: 100 + (width - bigger.width) / 2,
      y: 100 + (height - bigger.height) / 2,
      width: bigger.width,
      height: bigger.height,
    });
  });

  it("accept only known kinds from quick styles", () => {
    expect(sanitizeStyle("stamp", { stamp: "drag" }).stamp).toBe("drag");
    expect(sanitizeStyle("stamp", { stamp: "kick" }).stamp).toBe("left");
  });
});
