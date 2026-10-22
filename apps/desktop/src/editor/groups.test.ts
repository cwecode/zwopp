import { describe, expect, it } from "vitest";
import {
  addLayer,
  createDocument,
  expandToGroups,
  groupMembers,
  groupShapes,
  loadDocument,
  orderedShapes,
  removeShapes,
  selectedGroup,
  setGroupFrame,
  ungroup,
  type EditorDocument,
  type RectShape,
} from "./document";

function box(id: string, layer: string): RectShape {
  return { id, layer, type: "rect", x: 0, y: 0, width: 10, height: 10, stroke: "#000", strokeWidth: 1 };
}

/** Bottom layer [a, b, c, d], top layer [e]. */
function fixture(): { doc: EditorDocument; bottom: string; top: string } {
  const base = createDocument(100, 100);
  const bottom = base.layers[0].id;
  const { doc: withTop, id: top } = addLayer(base);
  const objects = [box("a", bottom), box("b", bottom), box("c", bottom), box("d", bottom), box("e", top)];
  return { doc: { ...withTop, objects }, bottom, top };
}

const ids = (doc: EditorDocument) => orderedShapes(doc).map((s) => s.id);

describe("blocks", () => {
  it("groups shapes together at the position of the topmost one", () => {
    const { doc, bottom } = fixture();
    const result = groupShapes(doc, ["a", "c"])!;
    expect(ids(result.doc)).toEqual(["b", "a", "c", "d", "e"]);
    expect(groupMembers(result.doc, result.id).map((s) => s.id)).toEqual(["a", "c"]);
    expect(result.doc.groups[0].name).toBe("Block 1");
    expect(result.doc.objects.every((s) => s.group !== result.id || s.layer === bottom)).toBe(true);
  });

  it("pulls shapes from other layers into the topmost member's layer", () => {
    const { doc, top } = fixture();
    const result = groupShapes(doc, ["b", "e"])!;
    expect(ids(result.doc)).toEqual(["a", "c", "d", "b", "e"]);
    expect(groupMembers(result.doc, result.id).every((s) => s.layer === top)).toBe(true);
  });

  it("needs at least two shapes", () => {
    expect(groupShapes(fixture().doc, ["a"])).toBeNull();
  });

  it("dissolves blocks that were merged or lost members", () => {
    const { doc } = fixture();
    const first = groupShapes(doc, ["a", "b"])!;
    const merged = groupShapes(first.doc, ["b", "c"])!;
    // "a" alone is no block any more.
    expect(merged.doc.groups.map((g) => g.id)).toEqual([merged.id]);
    expect(merged.doc.objects.find((s) => s.id === "a")!.group).toBeUndefined();
    const shrunk = removeShapes(merged.doc, ["b"]);
    expect(shrunk.groups).toEqual([]);
  });

  it("ungroups, keeping the shapes", () => {
    const { doc } = fixture();
    const { doc: grouped, id } = groupShapes(doc, ["a", "b"])!;
    const plain = ungroup(grouped, id);
    expect(plain.groups).toEqual([]);
    expect(plain.objects).toHaveLength(5);
    expect(plain.objects.every((s) => !s.group)).toBe(true);
  });

  it("recognizes and expands block selections", () => {
    const { doc } = fixture();
    const { doc: grouped, id } = groupShapes(doc, ["a", "b"])!;
    expect(selectedGroup(grouped, ["a", "b"])?.id).toBe(id);
    expect(selectedGroup(grouped, ["a"])).toBeNull();
    expect(selectedGroup(grouped, ["a", "b", "c"])).toBeNull();
    expect(expandToGroups(grouped, ["b", "d"]).sort()).toEqual(["a", "b", "d"]);
  });

  it("stores frames and survives a round trip", () => {
    const { doc } = fixture();
    const { doc: grouped, id } = groupShapes(doc, ["a", "b"])!;
    const framed = setGroupFrame(grouped, id, { stroke: "#f00", strokeWidth: 4, padding: 12 });
    const loaded = loadDocument(JSON.parse(JSON.stringify(framed)), 100, 100);
    expect(loaded.groups[0].frame).toEqual({ stroke: "#f00", strokeWidth: 4, padding: 12 });
    expect(groupMembers(loaded, id)).toHaveLength(2);
  });
});
