import { describe, expect, it } from "vitest";
import {
  addLayer,
  contentBounds,
  imageBounds,
  createDocument,
  moveLayer,
  moveShapes,
  orderedShapes,
  placeShapes,
  removeLayer,
  updateLayer,
  visibleShapes,
  type EditorDocument,
  type RectShape,
} from "./document";

function box(id: string, layer: string, x = 0): RectShape {
  return { id, layer, type: "rect", x, y: 0, width: 10, height: 10, stroke: "#000", strokeWidth: 1 };
}

/** Two layers: bottom [a, b, c], top [d]. */
function fixture(): { doc: EditorDocument; bottom: string; top: string } {
  const base = createDocument(100, 100);
  const bottom = base.layers[0].id;
  const { doc: withTop, id: top } = addLayer(base, "Ebene");
  // Array order deliberately mixed: paint order is by layer first.
  const doc = { ...withTop, objects: [box("d", top), box("a", bottom), box("b", bottom), box("c", bottom)] };
  return { doc, bottom, top };
}

const ids = (doc: EditorDocument) => orderedShapes(doc).map((s) => s.id);

describe("layers", () => {
  it("paints by layer, then by array order", () => {
    expect(ids(fixture().doc)).toEqual(["a", "b", "c", "d"]);
  });

  it("names new layers with the next number", () => {
    const { doc } = fixture();
    expect(addLayer(doc, "Ebene").doc.layers.map((l) => l.name)).toEqual(["Original", "Ebene 1", "Ebene 2"]);
  });

  it("numbers new layers per language", () => {
    const { doc } = fixture();
    const english = addLayer(addLayer(doc, "Layer").doc, "Layer").doc;
    expect(english.layers.map((l) => l.name)).toEqual(["Original", "Ebene 1", "Layer 1", "Layer 2"]);
  });

  it("hides shapes of hidden layers, also from the bounds", () => {
    const { doc, top } = fixture();
    const far = { ...doc, objects: [...doc.objects, box("far", top, 500)] };
    const hidden = updateLayer(far, top, { visible: false });
    expect(visibleShapes(hidden).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(contentBounds(far)!.width).toBeGreaterThan(500);
    expect(contentBounds(hidden)!.width).toBeLessThan(102);
  });

  it("removes a layer with its shapes but keeps the last one", () => {
    const { doc, top, bottom } = fixture();
    const removed = removeLayer(doc, top);
    expect(removed.layers).toHaveLength(1);
    expect(ids(removed)).toEqual(["a", "b", "c"]);
    expect(removeLayer(removed, bottom)).toBe(removed);
  });

  it("reorders layers but keeps the base layer at the bottom", () => {
    const { doc, top, bottom } = fixture();
    const { doc: three, id: third } = addLayer(doc, "Ebene");
    const withE = { ...three, objects: [...three.objects, box("e", third)] };
    expect(ids(moveLayer(withE, third, 1))).toEqual(["a", "b", "c", "e", "d"]);
    // Index 0 is clamped to 1: nothing goes below the base layer.
    expect(ids(moveLayer(moveLayer(withE, third, 1), top, 0))).toEqual(["a", "b", "c", "d", "e"]);
    expect(moveLayer(withE, bottom, 2)).toBe(withE);
  });

  it("hides the screenshot with the base layer", () => {
    const { doc, bottom } = fixture();
    expect(imageBounds(doc)).not.toBeNull();
    expect(imageBounds(updateLayer(doc, bottom, { visible: false }))).toBeNull();
  });

  it("moves shapes forward and backward within their layer", () => {
    const { doc } = fixture();
    expect(ids(moveShapes(doc, ["a"], "forward"))).toEqual(["b", "a", "c", "d"]);
    expect(ids(moveShapes(doc, ["c"], "forward"))).toEqual(["a", "b", "c", "d"]);
    expect(ids(moveShapes(doc, ["c"], "backward"))).toEqual(["a", "c", "b", "d"]);
    expect(ids(moveShapes(doc, ["a", "b"], "forward"))).toEqual(["c", "a", "b", "d"]);
    expect(ids(moveShapes(doc, ["a"], "front"))).toEqual(["b", "c", "a", "d"]);
    expect(ids(moveShapes(doc, ["c", "d"], "back"))).toEqual(["c", "a", "b", "d"]);
  });

  it("places shapes into another layer above a target", () => {
    const { doc, top } = fixture();
    const moved = placeShapes(doc, ["a", "c"], top, null);
    expect(ids(moved)).toEqual(["b", "d", "a", "c"]);
    expect(moved.objects.filter((s) => s.layer === top).map((s) => s.id)).toEqual(["d", "a", "c"]);
    const below = placeShapes(doc, ["d"], doc.layers[0].id, "a");
    expect(ids(below)).toEqual(["a", "d", "b", "c"]);
    expect(placeShapes(doc, ["a"], top, "a")).toBe(doc);
  });
});
