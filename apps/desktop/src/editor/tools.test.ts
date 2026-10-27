import { describe, expect, it } from "vitest";
import { arrowHeads, loadDocument, updateShape, type ArrowShape, type RectShape } from "./document";
import { stylePatch, toolOf } from "./tools";

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
