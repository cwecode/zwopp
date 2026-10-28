import { describe, expect, it } from "vitest";
import {
  arrowHeads,
  contrastColor,
  createDocument,
  loadDocument,
  magnifierFor,
  nextStepNumber,
  shapeBounds,
  translateShape,
  updateShape,
  type ArrowShape,
  type EmojiShape,
  type MagnifyShape,
  type RectShape,
  type StepShape,
  type TextShape,
} from "./document";
import { SIZES, emojiSize, stepDiameter, stylePatch, toolOf } from "./tools";

const arrow = (heads: Partial<ArrowShape> = {}): ArrowShape => ({
  id: "a",
  layer: "L",
  type: "arrow",
  points: [0, 0, 10, 10],
  stroke: "#000",
  strokeWidth: 5,
  ...heads,
});

const rect = (fill?: string): RectShape => ({
  id: "r",
  layer: "L",
  type: "rect",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  stroke: "#e5322d",
  strokeWidth: 5,
  ...(fill && { fill }),
});

describe("lines and arrows", () => {
  it("default to a filled head at the end, as before version 3", () => {
    expect(arrowHeads(arrow())).toEqual({ start: "none", end: "filled" });
  });

  it("are a line without heads", () => {
    expect(toolOf(arrow())).toBe("arrow");
    expect(toolOf(arrow({ startHead: "none", endHead: "none" }))).toBe("line");
    expect(toolOf(arrow({ startHead: "open", endHead: "none" }))).toBe("arrow");
  });

  it("take the heads chosen in the toolbar", () => {
    expect(stylePatch(arrow(), { heads: { start: "open", end: "open" } })).toEqual({
      startHead: "open",
      endHead: "open",
    });
  });
});

describe("filled shapes", () => {
  it("fill with their colour and back", () => {
    const filled = { ...rect(), ...stylePatch(rect(), { filled: true }) } as RectShape;
    expect(filled.fill).toBe("#e5322d");
    const outline = updateShape({ ...loadDocument(null, 10, 10), objects: [filled] }, "r", stylePatch(filled, { filled: false }));
    expect(JSON.parse(JSON.stringify(outline.objects[0]))).not.toHaveProperty("fill");
  });

  it("keep the fill in line with the colour", () => {
    expect(stylePatch(rect("#e5322d"), { color: "#2f80ed" })).toMatchObject({ stroke: "#2f80ed", fill: "#2f80ed" });
    expect(stylePatch(rect(), { color: "#2f80ed" })).toMatchObject({ fill: undefined });
    expect(stylePatch(rect("#e5322d"), { size: 2 })).not.toHaveProperty("fill");
  });
});

describe("version 3 documents", () => {
  it("load version 2 documents unchanged", () => {
    const stored = {
      schemaVersion: 2,
      layers: [{ id: "L", name: "Original", visible: true, locked: false }],
      objects: [arrow(), rect()],
    };
    const doc = loadDocument(stored, 100, 50);
    expect(doc.schemaVersion).toBe(3);
    expect(doc.objects).toEqual(stored.objects);
  });

  it("reject unknown versions", () => {
    expect(loadDocument({ schemaVersion: 4, objects: [arrow()] }, 100, 50).objects).toEqual([]);
  });
});

const text = (extra: Partial<TextShape> = {}): TextShape => ({
  id: "t",
  layer: "L",
  type: "text",
  x: 100,
  y: 100,
  text: "Hallo",
  fontSize: 20,
  fill: "#e5322d",
  ...extra,
});

const step = (number: number): StepShape => ({
  id: `s${number}`,
  layer: "L",
  type: "step",
  x: 0,
  y: 0,
  width: 36,
  height: 36,
  number,
  fill: "#e5322d",
});

describe("text with background", () => {
  it("contrasts with its background", () => {
    expect(contrastColor("#ffffff")).toBe("#1d1d1b");
    expect(contrastColor("#f2c94c")).toBe("#1d1d1b");
    expect(contrastColor("#e5322d")).toBe("#ffffff");
    expect(contrastColor("#1d1d1b")).toBe("#ffffff");
  });

  it("puts the colour into the background and back", () => {
    const boxed = { ...text(), ...stylePatch(text(), { background: true }) } as TextShape;
    expect(boxed).toMatchObject({ background: "#e5322d", fill: "#ffffff" });
    expect(stylePatch(boxed, { color: "#f2c94c" })).toEqual({ background: "#f2c94c", fill: "#1d1d1b" });
    expect(stylePatch(boxed, { background: false })).toEqual({ background: undefined, fill: "#e5322d" });
  });

  it("keeps its colours when only the font or size changes", () => {
    expect(stylePatch(text({ background: "#2f80ed", fill: "#ffffff" }), { font: "mono", size: 2 })).toEqual({
      font: "mono",
      fontSize: SIZES[2].fontSize,
    });
  });
});

describe("callouts", () => {
  const callout = text({ background: "#2f80ed", fill: "#ffffff", tail: [20, 300] });

  it("are texts with a pointer", () => {
    expect(toolOf(callout)).toBe("callout");
    expect(toolOf(text())).toBe("text");
  });

  it("take the pointer along when moved as a whole", () => {
    expect(translateShape(callout, 10, -5).tail).toEqual([30, 295]);
  });

  it("count the pointer and the box padding for the output", () => {
    const bounds = shapeBounds(callout);
    expect(bounds.x).toBeLessThanOrEqual(20);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(300);
    expect(shapeBounds(text({ background: "#fff" })).x).toBeLessThan(100);
  });
});

describe("step numbers", () => {
  it("count on from the highest number", () => {
    const doc = createDocument(10, 10);
    expect(nextStepNumber(doc)).toBe(1);
    expect(nextStepNumber({ ...doc, objects: [step(1), step(4), text()] })).toBe(5);
  });

  it("change size around their centre", () => {
    const patch = stylePatch(step(1), { size: 3 });
    const diameter = stepDiameter(SIZES[3]);
    expect(patch).toMatchObject({ width: diameter, height: diameter, x: (36 - diameter) / 2 });
    expect(toolOf(step(1))).toBe("step");
  });
});
const magnifier = (extra: Partial<MagnifyShape> = {}): MagnifyShape => ({
  id: "m",
  layer: "L",
  type: "magnify",
  x: 300,
  y: 80,
  width: 200,
  height: 100,
  source: { x: 100, y: 105, width: 100, height: 50 },
  stroke: "#e5322d",
  strokeWidth: 3,
  ...extra,
});

describe("magnifiers", () => {
  it("open twice as large next to the source, on the side with more room", () => {
    const source = { x: 100, y: 100, width: 100, height: 50 };
    const right = magnifierFor(source, 1000);
    expect(right).toMatchObject({ width: 200, height: 100, y: 75 });
    expect(right.x).toBeGreaterThan(200);
    const left = magnifierFor({ ...source, x: 800 }, 1000);
    expect(left.x + left.width).toBeLessThan(800);
  });

  it("move with their source as a whole", () => {
    const moved = translateShape(magnifier(), 10, 20);
    expect(moved).toMatchObject({ x: 310, y: 100, source: { x: 110, y: 125 } });
  });

  it("count the source for the output", () => {
    const bounds = shapeBounds(magnifier());
    expect(bounds.x).toBeLessThanOrEqual(100);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(500);
  });

  it("take colour, size and shape from the toolbar", () => {
    expect(stylePatch(magnifier(), { color: "#2f80ed", size: 2, round: true })).toEqual({
      stroke: "#2f80ed",
      strokeWidth: SIZES[2].strokeWidth,
      round: true,
    });
    expect(toolOf(magnifier())).toBe("magnify");
  });
});

describe("emoji stickers", () => {
  const sticker: EmojiShape = { id: "e", layer: "L", type: "emoji", x: 0, y: 0, width: 52, height: 52, emoji: "👍" };

  it("swap the emoji and resize around their centre", () => {
    expect(stylePatch(sticker, { emoji: "✅" })).toEqual({ emoji: "✅" });
    const edge = emojiSize(SIZES[3]);
    expect(stylePatch(sticker, { size: 3 })).toMatchObject({ width: edge, height: edge, x: (52 - edge) / 2 });
    expect(toolOf(sticker)).toBe("emoji");
  });
});