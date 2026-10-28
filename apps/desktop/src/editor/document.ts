// The annotation document: a vector description of everything drawn on top of
// a screenshot. Stored as `document.json` next to the untouched original.
// The format is specified in docs/spec/document-format.md — keep both in sync.

export const SCHEMA_VERSION = 3;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ShapeBase {
  id: string;
  /** Id of the layer the shape belongs to. */
  layer: string;
  /** Id of the block (group) the shape is part of, if any. */
  group?: string;
}

/** Border drawn around a block. */
export interface Frame {
  stroke: string;
  strokeWidth: number;
  /** Space between the block's content and the frame, in image px. */
  padding: number;
}

/** Shapes that are selected, moved and scaled as one unit, like a CAD block. */
export interface Group {
  id: string;
  name: string;
  frame: Frame | null;
}

/** A group of shapes, like a layer in an image editor. */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** Locked layers are shown but cannot be selected or changed on the canvas. */
  locked: boolean;
}

/** End of a line: plain, a filled triangle or an open "V". */
export type ArrowHead = "none" | "filled" | "open";

/** A straight line, with or without arrowheads (the line tool makes one without). */
export interface ArrowShape extends ShapeBase {
  type: "arrow";
  /** Start and end: [x1, y1, x2, y2]. */
  points: [number, number, number, number];
  stroke: string;
  strokeWidth: number;
  /** Head at the start; default "none". */
  startHead?: ArrowHead;
  /** Head at the end; default "filled". */
  endHead?: ArrowHead;
}

export interface RectShape extends ShapeBase, Rect {
  type: "rect";
  stroke: string;
  strokeWidth: number;
  /** Fill colour; omitted = outline only. */
  fill?: string;
}

export interface EllipseShape extends ShapeBase, Rect {
  type: "ellipse";
  stroke: string;
  strokeWidth: number;
  /** Fill colour; omitted = outline only. */
  fill?: string;
}

export type FontFamily = "sans" | "serif" | "mono";

/** A text box; with `background` and `tail` it is a callout (speech bubble). */
export interface TextShape extends ShapeBase {
  type: "text";
  x: number;
  y: number;
  /** Box width; text wraps inside it. Omitted = grows with the text. */
  width?: number;
  text: string;
  fontSize: number;
  /** Text colour. */
  fill: string;
  /** Default "sans". */
  font?: FontFamily;
  /** Colour of a rounded box behind the text (padding `textPadding`); omitted = none. */
  background?: string;
  /** Tip of the callout's pointer, in image px; omitted = no pointer. */
  tail?: [number, number];
}

/** A numbered badge for step-by-step instructions. */
export interface StepShape extends ShapeBase, Rect {
  type: "step";
  number: number;
  fill: string;
}

/** An emoji used as a sticker, drawn with the system's emoji font into its square. */
export interface EmojiShape extends ShapeBase, Rect {
  type: "emoji";
  emoji: string;
}

/**
 * A magnifier: the area `source` of the screenshot (blurs and deletions
 * applied) enlarged into its own rectangle, framed, with the source marked
 * and joined to it by a line.
 */
export interface MagnifyShape extends ShapeBase, Rect {
  type: "magnify";
  source: Rect;
  stroke: string;
  strokeWidth: number;
  /** Round (ellipse) instead of a rounded rectangle. */
  round?: boolean;
}

export interface HighlightShape extends ShapeBase, Rect {
  type: "highlight";
  fill: string;
}

export interface BlurShape extends ShapeBase, Rect {
  type: "blur";
  /** Edge length of the pixelation blocks, in image pixels. */
  pixelSize: number;
}

export interface ImageShape extends ShapeBase, Rect {
  type: "image";
  /** File name in the item's `assets/` folder. */
  asset: string;
}

export type Shape =
  | ArrowShape
  | RectShape
  | EllipseShape
  | TextShape
  | StepShape
  | EmojiShape
  | MagnifyShape
  | HighlightShape
  | BlurShape
  | ImageShape;
export type ShapeType = Shape["type"];

export interface EditorDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Size of the original image; all coordinates are in its pixels. */
  canvas: { width: number; height: number };
  /** Areas of the original image that were deleted (rendered transparent). */
  erased: Rect[];
  /** Layers above the screenshot, bottom to top. Never empty. */
  layers: Layer[];
  /**
   * All shapes. Paint order is by layer, then by position in this array
   * (later is on top). They may extend beyond the image.
   */
  objects: Shape[];
  /** Blocks; members reference them via `Shape.group`. */
  groups: Group[];
}

export const LINE_HEIGHT = 1.2;
/** Rough average glyph width relative to the font size, for layout estimates. */
const GLYPH_WIDTH = 0.6;

/** The heads of a line, with their defaults filled in. */
export function arrowHeads(shape: ArrowShape): { start: ArrowHead; end: ArrowHead } {
  return { start: shape.startHead ?? "none", end: shape.endHead ?? "filled" };
}

/** Length and width of an arrowhead for a line of `strokeWidth`. */
export const headSize = (strokeWidth: number) => strokeWidth * 3 + 6;

/** Space between a text and its background box. */
export const textPadding = (fontSize: number) => Math.round(fontSize * 0.35);

/** Black or white, whichever reads better on `background` (#rrggbb). */
export function contrastColor(background: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? "#1d1d1b" : "#ffffff";
}

/** The number for the next step badge: one more than the highest so far. */
export function nextStepNumber(doc: EditorDocument): number {
  return Math.max(0, ...doc.objects.map((s) => (s.type === "step" ? s.number : 0))) + 1;
}

/**
 * The bottom layer always holds the original screenshot (drawn first, below
 * its shapes). It cannot be deleted or moved; hiding it hides the screenshot.
 */
export const BASE_LAYER_NAME = "Original";

export function baseLayer(doc: EditorDocument): Layer {
  return doc.layers[0];
}

export function createLayer(name: string): Layer {
  return { id: newId(), name, visible: true, locked: false };
}

export function createDocument(width: number, height: number): EditorDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    canvas: { width, height },
    erased: [],
    layers: [createLayer(BASE_LAYER_NAME)],
    objects: [],
    groups: [],
  };
}

/**
 * Accepts a stored document (migrating older versions), or starts a fresh one
 * if it is missing or unknown.
 */
export function loadDocument(stored: unknown, width: number, height: number): EditorDocument {
  const doc = stored as (Partial<Omit<EditorDocument, "schemaVersion">> & { schemaVersion?: number }) | null;
  // Version 3 only added optional fields and shape types: older documents are valid as they are.
  const known = [1, 2, SCHEMA_VERSION];
  if (!doc || !Array.isArray(doc.objects) || !known.includes(doc.schemaVersion ?? 0)) {
    return createDocument(width, height);
  }
  const fresh = createDocument(width, height);
  // Version 1 had no layers: everything goes into the base layer. Early
  // version 2 documents called the base layer "Ebene 1".
  const storedLayers = Array.isArray(doc.layers) && doc.layers.length ? doc.layers : fresh.layers;
  const layers = storedLayers.map((l, i) => (i === 0 && l.name === "Ebene 1" ? { ...l, name: BASE_LAYER_NAME } : l));
  const layerIds = new Set(layers.map((l) => l.id));
  return pruneGroups({
    ...fresh,
    erased: Array.isArray(doc.erased) ? doc.erased : [],
    layers,
    objects: doc.objects.map((s) => (layerIds.has(s.layer) ? s : { ...s, layer: layers[0].id })),
    groups: Array.isArray(doc.groups) ? doc.groups : [],
  });
}

export function newId(): string {
  return crypto.randomUUID();
}

export function addShape(doc: EditorDocument, shape: Shape): EditorDocument {
  return { ...doc, objects: [...doc.objects, shape] };
}

export function updateShape(doc: EditorDocument, id: string, patch: Partial<Shape>): EditorDocument {
  return {
    ...doc,
    objects: doc.objects.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s)),
  };
}

export function removeShapes(doc: EditorDocument, ids: string[]): EditorDocument {
  return pruneGroups({ ...doc, objects: doc.objects.filter((s) => !ids.includes(s.id)) });
}

export function translateShape<T extends Shape>(shape: T, dx: number, dy: number): T {
  if (shape.type === "arrow") {
    const [x1, y1, x2, y2] = shape.points;
    return { ...shape, points: [x1 + dx, y1 + dy, x2 + dx, y2 + dy] };
  }
  if (shape.type === "magnify") {
    const source = { ...shape.source, x: shape.source.x + dx, y: shape.source.y + dy };
    return { ...shape, x: shape.x + dx, y: shape.y + dy, source };
  }
  if (shape.type === "text" && shape.tail) {
    return { ...shape, x: shape.x + dx, y: shape.y + dy, tail: [shape.tail[0] + dx, shape.tail[1] + dy] };
  }
  return { ...shape, x: shape.x + dx, y: shape.y + dy };
}

/**
 * Deletes an area: the image underneath becomes transparent and shapes lying
 * completely inside the area are removed.
 */
export function eraseArea(doc: EditorDocument, area: Rect): EditorDocument {
  const image = clampRect(area, doc.canvas.width, doc.canvas.height);
  const objects = doc.objects.filter((s) => !containsRect(area, shapeBounds(s)));
  const erased = image.width > 0 && image.height > 0 ? [...doc.erased, image] : doc.erased;
  if (objects.length === doc.objects.length && erased === doc.erased) return doc;
  return pruneGroups({ ...doc, erased, objects });
}

/** Rectangle spanned by two points, regardless of drag direction. */
export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** Rounds to whole pixels and keeps the rectangle inside width × height. */
export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x1 = Math.round(Math.min(Math.max(rect.x, 0), width));
  const y1 = Math.round(Math.min(Math.max(rect.y, 0), height));
  const x2 = Math.round(Math.min(Math.max(rect.x + rect.width, 0), width));
  const y2 = Math.round(Math.min(Math.max(rect.y + rect.height, 0), height));
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Bounding box of what is left of the image after deletions, or null if
 * nothing is left. Deleting a strip at an edge therefore shrinks the image.
 */
export function imageBounds(doc: EditorDocument): Rect | null {
  if (doc.layers[0] && !doc.layers[0].visible) return null;
  const { width, height } = doc.canvas;
  // Split the image into cells along all deletion edges; a cell is either
  // fully deleted or fully kept.
  const edges = (pick: (r: Rect) => [number, number], max: number) =>
    [...new Set([0, max, ...doc.erased.flatMap(pick)])]
      .filter((v) => v >= 0 && v <= max)
      .sort((a, b) => a - b);
  const xs = edges((r) => [r.x, r.x + r.width], width);
  const ys = edges((r) => [r.y, r.y + r.height], height);
  let bounds: Rect | null = null;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      const deleted = doc.erased.some(
        (r) => cx > r.x && cx < r.x + r.width && cy > r.y && cy < r.y + r.height,
      );
      if (!deleted) {
        bounds = unionRect(bounds, { x: xs[i], y: ys[j], width: xs[i + 1] - xs[i], height: ys[j + 1] - ys[j] });
      }
    }
  }
  return bounds;
}

/** Approximate bounds of a shape (text size is estimated). */
export function shapeBounds(shape: Shape): Rect {
  switch (shape.type) {
    case "arrow": {
      const [x1, y1, x2, y2] = shape.points;
      const pad = shape.strokeWidth * 2 + 6;
      const r = rectFromPoints(x1, y1, x2, y2);
      return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
    }
    case "rect":
    case "ellipse": {
      const pad = shape.strokeWidth / 2;
      return { x: shape.x - pad, y: shape.y - pad, width: shape.width + pad * 2, height: shape.height + pad * 2 };
    }
    case "text": {
      const lines = shape.text.split("\n");
      const longest = Math.max(1, ...lines.map((l) => l.length));
      const pad = shape.background ? textPadding(shape.fontSize) : 0;
      const box = {
        x: shape.x - pad,
        y: shape.y - pad,
        width: (shape.width ?? longest * shape.fontSize * GLYPH_WIDTH) + pad * 2,
        height: lines.length * shape.fontSize * LINE_HEIGHT + pad * 2,
      };
      if (!shape.tail) return box;
      const [tx, ty] = shape.tail;
      return unionRect(box, { x: tx - 1, y: ty - 1, width: 2, height: 2 })!;
    }
    case "magnify": {
      const pad = shape.strokeWidth / 2;
      const inset = { x: shape.x - pad, y: shape.y - pad, width: shape.width + pad * 2, height: shape.height + pad * 2 };
      return unionRect(inset, shape.source)!;
    }
    default:
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
}

/** Default magnification of a new magnifier. */
export const MAGNIFY_ZOOM = 2;

/**
 * Where a new magnifier for `source` goes: twice as large, next to it on the
 * right (or on the left if that side of the image has more room).
 */
export function magnifierFor(source: Rect, imageWidth: number): Rect {
  const width = source.width * MAGNIFY_ZOOM;
  const height = source.height * MAGNIFY_ZOOM;
  const gap = Math.max(24, source.width * 0.25);
  const right = source.x + source.width + gap;
  const spaceRight = imageWidth - (source.x + source.width);
  const x = spaceRight >= source.x ? right : source.x - gap - width;
  return { x, y: source.y + source.height / 2 - height / 2, width, height };
}

/** Everything that ends up in the exported image: remaining image plus shapes. */
export function contentBounds(doc: EditorDocument): Rect | null {
  return visibleShapes(doc).reduce<Rect | null>((acc, s) => unionRect(acc, shapeBounds(s)), imageBounds(doc));
}

// ---- Layers and stacking order ----

export function layerOf(doc: EditorDocument, shape: Shape): Layer | undefined {
  return doc.layers.find((l) => l.id === shape.layer);
}

/** Shapes per layer (bottom to top), each list in paint order. */
function shapesByLayer(doc: EditorDocument): Map<string, Shape[]> {
  const lists = new Map(doc.layers.map((l) => [l.id, [] as Shape[]]));
  for (const shape of doc.objects) (lists.get(shape.layer) ?? lists.get(doc.layers[0].id))!.push(shape);
  return lists;
}

function fromLists(doc: EditorDocument, lists: Map<string, Shape[]>): EditorDocument {
  return { ...doc, objects: doc.layers.flatMap((l) => lists.get(l.id) ?? []) };
}

/** All shapes in paint order (bottom first). */
export function orderedShapes(doc: EditorDocument): Shape[] {
  return [...shapesByLayer(doc).values()].flat();
}

/** Shapes in paint order, without those on hidden layers. */
export function visibleShapes(doc: EditorDocument): Shape[] {
  const hidden = new Set(doc.layers.filter((l) => !l.visible).map((l) => l.id));
  return orderedShapes(doc).filter((s) => !hidden.has(s.layer));
}

/**
 * Adds an empty layer on top, named `prefix` and the next free number (e.g.
 * "Ebene 2" or "Layer 2", depending on the UI language). Returns the document
 * and the new layer's id.
 */
export function addLayer(doc: EditorDocument, prefix: string): { doc: EditorDocument; id: string } {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped} (\\d+)$`);
  const numbers = doc.layers.map((l) => Number(pattern.exec(l.name)?.[1] ?? 0));
  const layer = createLayer(`${prefix} ${Math.max(0, ...numbers) + 1}`);
  return { doc: { ...doc, layers: [...doc.layers, layer] }, id: layer.id };
}

/** Removes a layer with all its shapes. The base layer cannot be removed. */
export function removeLayer(doc: EditorDocument, id: string): EditorDocument {
  if (doc.layers.length <= 1 || id === doc.layers[0].id) return doc;
  return pruneGroups({
    ...doc,
    layers: doc.layers.filter((l) => l.id !== id),
    objects: doc.objects.filter((s) => s.layer !== id),
  });
}

export function updateLayer(doc: EditorDocument, id: string, patch: Partial<Omit<Layer, "id">>): EditorDocument {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
}

/** Moves a layer to `index` in the bottom-to-top order (never below the base layer). */
export function moveLayer(doc: EditorDocument, id: string, index: number): EditorDocument {
  const layer = doc.layers.find((l) => l.id === id);
  // The base layer stays at the bottom.
  if (!layer || id === doc.layers[0].id) return doc;
  const rest = doc.layers.filter((l) => l.id !== id);
  const at = Math.max(1, Math.min(rest.length, index));
  return fromLists({ ...doc, layers: [...rest.slice(0, at), layer, ...rest.slice(at)] }, shapesByLayer(doc));
}

export type StackMove = "forward" | "backward" | "front" | "back";

/** Changes the stacking order of shapes within their layers. */
export function moveShapes(doc: EditorDocument, ids: string[], move: StackMove): EditorDocument {
  const selected = new Set(ids);
  const lists = shapesByLayer(doc);
  for (const [layer, list] of lists) {
    let next = [...list];
    if (move === "front" || move === "back") {
      const picked = next.filter((s) => selected.has(s.id));
      const rest = next.filter((s) => !selected.has(s.id));
      next = move === "front" ? [...rest, ...picked] : [...picked, ...rest];
    } else if (move === "forward") {
      for (let i = next.length - 2; i >= 0; i--) {
        if (selected.has(next[i].id) && !selected.has(next[i + 1].id)) {
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
        }
      }
    } else {
      for (let i = 1; i < next.length; i++) {
        if (selected.has(next[i].id) && !selected.has(next[i - 1].id)) {
          [next[i], next[i - 1]] = [next[i - 1], next[i]];
        }
      }
    }
    lists.set(layer, next);
  }
  return fromLists(doc, lists);
}

/**
 * Moves shapes into `layer`, directly above the shape `aboveId` (or on top of
 * the layer if null). Their relative order is kept.
 */
export function placeShapes(doc: EditorDocument, ids: string[], layer: string, aboveId: string | null): EditorDocument {
  if (!doc.layers.some((l) => l.id === layer) || (aboveId && ids.includes(aboveId))) return doc;
  const moving = orderedShapes(doc)
    .filter((s) => ids.includes(s.id))
    .map((s) => ({ ...s, layer }));
  const lists = shapesByLayer(removeShapes(doc, ids));
  const target = lists.get(layer)!;
  const at = aboveId === null ? target.length : target.findIndex((s) => s.id === aboveId) + 1;
  if (at === 0 && aboveId !== null) return doc;
  lists.set(layer, [...target.slice(0, at), ...moving, ...target.slice(at)]);
  return fromLists(doc, lists);
}

// ---- Blocks (groups) ----

export function groupMembers(doc: EditorDocument, groupId: string): Shape[] {
  return orderedShapes(doc).filter((s) => s.group === groupId);
}

/** Drops blocks with fewer than two members and references to unknown blocks. */
export function pruneGroups(doc: EditorDocument): EditorDocument {
  const counts = new Map<string, number>();
  for (const s of doc.objects) if (s.group) counts.set(s.group, (counts.get(s.group) ?? 0) + 1);
  const keep = new Set(doc.groups.filter((g) => (counts.get(g.id) ?? 0) >= 2).map((g) => g.id));
  if (keep.size === doc.groups.length && doc.objects.every((s) => !s.group || keep.has(s.group))) return doc;
  return {
    ...doc,
    groups: doc.groups.filter((g) => keep.has(g.id)),
    objects: doc.objects.map((s) => {
      if (!s.group || keep.has(s.group)) return s;
      const { group: _, ...rest } = s;
      return rest as Shape;
    }),
  };
}

/**
 * Makes one block of the given shapes. They move into the layer of the
 * topmost one, stacked together at its position; blocks they belonged to
 * before are dissolved into the new one.
 */
export function groupShapes(doc: EditorDocument, ids: string[]): { doc: EditorDocument; id: string } | null {
  const ordered = orderedShapes(doc);
  const members = ordered.filter((s) => ids.includes(s.id));
  if (members.length < 2) return null;
  const top = members[members.length - 1];
  const numbers = doc.groups.map((g) => Number(/^Block (\d+)$/.exec(g.name)?.[1] ?? 0));
  const group: Group = { id: newId(), name: `Block ${Math.max(0, ...numbers) + 1}`, frame: null };

  const lists = shapesByLayer(doc);
  for (const [layer, list] of lists) lists.set(layer, list.filter((s) => !ids.includes(s.id)));
  const target = lists.get(top.layer)!;
  // Insert where the topmost member was: after the last non-member below it.
  const below = shapesByLayer(doc).get(top.layer)!;
  const topIndex = below.findIndex((s) => s.id === top.id);
  const anchor = below.slice(0, topIndex).filter((s) => !ids.includes(s.id)).length;
  const moved = members.map((s) => ({ ...s, layer: top.layer, group: group.id }));
  lists.set(top.layer, [...target.slice(0, anchor), ...moved, ...target.slice(anchor)]);

  const next = fromLists({ ...doc, groups: [...doc.groups, group] }, lists);
  return { doc: pruneGroups(next), id: group.id };
}

/** Dissolves a block; its shapes stay where they are. */
export function ungroup(doc: EditorDocument, groupId: string): EditorDocument {
  return pruneGroups({ ...doc, groups: doc.groups.filter((g) => g.id !== groupId) });
}

export function setGroupFrame(doc: EditorDocument, groupId: string, frame: Frame | null): EditorDocument {
  return { ...doc, groups: doc.groups.map((g) => (g.id === groupId ? { ...g, frame } : g)) };
}

/** The block if `ids` are exactly all members of one block, else null. */
export function selectedGroup(doc: EditorDocument, ids: string[]): Group | null {
  const first = doc.objects.find((s) => s.id === ids[0]);
  const group = first?.group && doc.groups.find((g) => g.id === first.group);
  if (!group) return null;
  const members = doc.objects.filter((s) => s.group === group.id).map((s) => s.id);
  return members.length === ids.length && members.every((id) => ids.includes(id)) ? group : null;
}

/** Expands a selection so that every touched block is selected completely. */
export function expandToGroups(doc: EditorDocument, ids: string[]): string[] {
  const groups = new Set(doc.objects.filter((s) => ids.includes(s.id) && s.group).map((s) => s.group));
  return doc.objects.filter((s) => ids.includes(s.id) || (s.group && groups.has(s.group))).map((s) => s.id);
}
