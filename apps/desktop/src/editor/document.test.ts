import { describe, expect, it } from "vitest";
import {
  addShape,
  clampRect,
  contentBounds,
  createDocument,
  eraseArea,
  imageBounds,
  loadDocument,
  rectFromPoints,
  removeShapes,
  translateShape,
  unionRect,
  updateShape,
  type ArrowShape,
  type RectShape,
} from "./document";

const rect: RectShape = {
  id: "r1",
  type: "rect",
  x: 1,
  y: 2,
  width: 3,
  height: 4,
  stroke: "#000",
  strokeWidth: 2,
};

const arrow: ArrowShape = {
  id: "a1",
  type: "arrow",
  points: [-50, -20, 10, 10],
  stroke: "#000",
  strokeWidth: 2,
};

describe("document", () => {
  it("adds, updates and removes shapes immutably", () => {
    const empty = createDocument(100, 50);
    const one = addShape(empty, rect);
    expect(empty.objects).toHaveLength(0);
    const moved = updateShape(one, "r1", { x: 10 });
    expect(moved.objects[0]).toMatchObject({ x: 10, y: 2 });
    expect(one.objects[0]).toMatchObject({ x: 1 });
    expect(removeShapes(moved, ["r1"]).objects).toHaveLength(0);
  });

  it("loads stored documents and rejects unknown versions", () => {
    const stored = { schemaVersion: 1, erased: [{ x: 1, y: 1, width: 5, height: 5 }], objects: [rect] };
    const doc = loadDocument(stored, 100, 50);
    expect(doc.objects).toEqual([rect]);
    expect(doc.erased).toHaveLength(1);
    expect(doc.canvas).toEqual({ width: 100, height: 50 });
    expect(loadDocument({ schemaVersion: 1, objects: [] }, 100, 50).erased).toEqual([]);
    expect(loadDocument({ schemaVersion: 99, objects: [rect] }, 100, 50).objects).toEqual([]);
    expect(loadDocument(null, 100, 50).objects).toEqual([]);
  });

  it("translates shapes", () => {
    expect(translateShape(rect, 5, -2)).toMatchObject({ x: 6, y: 0, width: 3 });
    expect(translateShape(arrow, 1, 1).points).toEqual([-49, -19, 11, 11]);
  });

  it("normalizes drag rectangles", () => {
    expect(rectFromPoints(10, 20, 4, 5)).toEqual({ x: 4, y: 5, width: 6, height: 15 });
  });

  it("clamps rectangles to the canvas", () => {
    expect(clampRect({ x: -5, y: 40.4, width: 30, height: 30 }, 20, 50)).toEqual({
      x: 0,
      y: 40,
      width: 20,
      height: 10,
    });
    expect(clampRect({ x: -50, y: 0, width: 10, height: 10 }, 20, 50).width).toBe(0);
  });

  it("unions rectangles", () => {
    expect(unionRect({ x: 0, y: 0, width: 10, height: 10 }, { x: -5, y: 5, width: 5, height: 20 })).toEqual({
      x: -5,
      y: 0,
      width: 15,
      height: 25,
    });
    expect(unionRect(null, null)).toBeNull();
  });
});

describe("erasing and bounds", () => {
  const doc = createDocument(100, 50);

  it("shrinks the image when an edge strip is deleted", () => {
    const bottom = eraseArea(doc, { x: -10, y: 30, width: 200, height: 100 });
    expect(bottom.erased).toEqual([{ x: 0, y: 30, width: 100, height: 20 }]);
    expect(imageBounds(bottom)).toEqual({ x: 0, y: 0, width: 100, height: 30 });
  });

  it("keeps the size when a hole is deleted", () => {
    expect(imageBounds(eraseArea(doc, { x: 10, y: 10, width: 20, height: 20 }))).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });

  it("combines deletions", () => {
    let d = eraseArea(doc, { x: 0, y: 0, width: 60, height: 50 });
    d = eraseArea(d, { x: 50, y: 0, width: 50, height: 25 });
    expect(imageBounds(d)).toEqual({ x: 60, y: 25, width: 40, height: 25 });
    expect(imageBounds(eraseArea(d, { x: 0, y: 0, width: 100, height: 50 }))).toBeNull();
  });

  it("removes shapes inside the deleted area only", () => {
    const d = eraseArea(addShape(addShape(doc, rect), arrow), { x: 0, y: 0, width: 20, height: 20 });
    expect(d.objects.map((s) => s.id)).toEqual(["a1"]);
  });

  it("ignores areas that hit nothing", () => {
    expect(eraseArea(doc, { x: 500, y: 500, width: 10, height: 10 })).toBe(doc);
  });

  it("grows beyond the image with shapes outside of it", () => {
    const bounds = contentBounds(addShape(doc, arrow))!;
    expect(bounds.x).toBeLessThan(-50);
    expect(bounds.y).toBeLessThan(-20);
    expect(bounds.x + bounds.width).toBe(100);
    expect(bounds.y + bounds.height).toBe(50);
  });
});
