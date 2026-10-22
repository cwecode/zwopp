// The annotation document: a vector description of everything drawn on top of
// a screenshot. Stored as `document.json` next to the untouched original.
// The format is specified in docs/spec/document-format.md — keep both in sync.

export const SCHEMA_VERSION = 1;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ShapeBase {
  id: string;
}

export interface ArrowShape extends ShapeBase {
  type: "arrow";
  /** Tail and head: [x1, y1, x2, y2]. */
  points: [number, number, number, number];
  stroke: string;
  strokeWidth: number;
}

export interface RectShape extends ShapeBase, Rect {
  type: "rect";
  stroke: string;
  strokeWidth: number;
}

export interface TextShape extends ShapeBase {
  type: "text";
  x: number;
  y: number;
  /** Box width; text wraps inside it. Omitted = grows with the text. */
  width?: number;
  text: string;
  fontSize: number;
  fill: string;
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

export type Shape = ArrowShape | RectShape | TextShape | HighlightShape | BlurShape | ImageShape;
export type ShapeType = Shape["type"];

export interface EditorDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Size of the original image; all coordinates are in its pixels. */
  canvas: { width: number; height: number };
  /** Areas of the original image that were deleted (rendered transparent). */
  erased: Rect[];
  /** Shapes in paint order (last is on top). They may extend beyond the image. */
  objects: Shape[];
}

export const LINE_HEIGHT = 1.2;
/** Rough average glyph width relative to the font size, for layout estimates. */
const GLYPH_WIDTH = 0.6;

export function createDocument(width: number, height: number): EditorDocument {
  return { schemaVersion: SCHEMA_VERSION, canvas: { width, height }, erased: [], objects: [] };
}

/** Accepts a stored document, or starts a fresh one if it is missing or unknown. */
export function loadDocument(stored: unknown, width: number, height: number): EditorDocument {
  const doc = stored as Partial<EditorDocument> | null;
  if (doc?.schemaVersion === SCHEMA_VERSION && Array.isArray(doc.objects)) {
    return {
      ...createDocument(width, height),
      erased: Array.isArray(doc.erased) ? doc.erased : [],
      objects: doc.objects,
    };
  }
  return createDocument(width, height);
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
  return { ...doc, objects: doc.objects.filter((s) => !ids.includes(s.id)) };
}

export function translateShape<T extends Shape>(shape: T, dx: number, dy: number): T {
  if (shape.type === "arrow") {
    const [x1, y1, x2, y2] = shape.points;
    return { ...shape, points: [x1 + dx, y1 + dy, x2 + dx, y2 + dy] };
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
  return { ...doc, erased, objects };
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
    case "rect": {
      const pad = shape.strokeWidth / 2;
      return { x: shape.x - pad, y: shape.y - pad, width: shape.width + pad * 2, height: shape.height + pad * 2 };
    }
    case "text": {
      const lines = shape.text.split("\n");
      const longest = Math.max(1, ...lines.map((l) => l.length));
      return {
        x: shape.x,
        y: shape.y,
        width: shape.width ?? longest * shape.fontSize * GLYPH_WIDTH,
        height: lines.length * shape.fontSize * LINE_HEIGHT,
      };
    }
    default:
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
}

/** Everything that ends up in the exported image: remaining image plus shapes. */
export function contentBounds(doc: EditorDocument): Rect | null {
  return doc.objects.reduce<Rect | null>((acc, s) => unionRect(acc, shapeBounds(s)), imageBounds(doc));
}
