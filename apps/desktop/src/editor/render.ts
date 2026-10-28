// Off-screen rendering helpers that do not need the Konva stage.
import { imageBounds, type EditorDocument, type MagnifyShape, type Rect } from "./document";

/**
 * The screenshot as it currently looks without annotations: deleted areas are
 * transparent and blurred areas are pixelated, so copying never leaks pixels
 * that were hidden. Returns null if nothing of the image is left.
 */
export async function renderBase(
  image: HTMLImageElement,
  doc: EditorDocument,
): Promise<{ png: Uint8Array; rect: Rect } | null> {
  const bounds = imageBounds(doc);
  if (!bounds) return null;
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  canvas.getContext("2d")!.drawImage(cleanImage(image, doc), -bounds.x, -bounds.y);
  return { png: await toPng(canvas), rect: bounds };
}

/**
 * The full screenshot with blurred areas pixelated and deleted areas
 * transparent: what anything showing the screenshot's pixels (copies,
 * magnifiers) may show.
 */
export function cleanImage(image: HTMLImageElement, doc: EditorDocument): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  for (const shape of doc.objects) {
    if (shape.type === "blur") pixelate(ctx, image, shape, shape.pixelSize);
  }
  for (const r of doc.erased) ctx.clearRect(r.x, r.y, r.width, r.height);
  return canvas;
}

/**
 * Draws a magnifier in image coordinates: the source area marked and joined
 * to the inset by a line, then the enlarged source clipped to the inset and
 * framed. `source` is the cleaned screenshot (see `cleanImage`).
 */
export function drawMagnifier(ctx: CanvasRenderingContext2D, source: CanvasImageSource, shape: MagnifyShape) {
  const { x, y, width, height, source: area, strokeWidth } = shape;
  const insetPath = () => {
    ctx.beginPath();
    if (shape.round) ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    else ctx.roundRect(x, y, width, height, Math.min(width, height) * 0.06);
  };
  ctx.save();
  ctx.strokeStyle = shape.stroke;
  ctx.lineJoin = "round";
  // The source area and the line from it to the inset, thinner than the frame.
  ctx.lineWidth = Math.max(1, strokeWidth / 2);
  ctx.strokeRect(area.x, area.y, area.width, area.height);
  const [sx, sy] = [area.x + area.width / 2, area.y + area.height / 2];
  const [ix, iy] = [x + width / 2, y + height / 2];
  ctx.beginPath();
  ctx.moveTo(...edgePoint(area, ix, iy));
  ctx.lineTo(...edgePoint(shape, sx, sy, shape.round));
  ctx.stroke();

  insetPath();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, area.x, area.y, area.width, area.height, x, y, width, height);
  ctx.restore();
  insetPath();
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
  ctx.restore();
}

/** Where the line from the centre of `r` towards (tx, ty) leaves `r` (or its ellipse). */
function edgePoint(r: Rect, tx: number, ty: number, round = false): [number, number] {
  const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
  const [dx, dy] = [tx - cx, ty - cy];
  if (!dx && !dy) return [cx, cy];
  const [hw, hh] = [r.width / 2, r.height / 2];
  const t = round
    ? 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh))
    : Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [cx + dx * Math.min(t, 1), cy + dy * Math.min(t, 1)];
}

/**
 * A magnifier as a PNG and the rectangle it covers, for copying it into
 * another screenshot (where its source would show other pixels).
 */
export async function renderMagnifier(
  source: CanvasImageSource,
  shape: MagnifyShape,
  bounds: Rect,
): Promise<{ png: Uint8Array; rect: Rect }> {
  const rect = {
    x: Math.floor(bounds.x),
    y: Math.floor(bounds.y),
    width: Math.ceil(bounds.width),
    height: Math.ceil(bounds.height),
  };
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, rect.width);
  canvas.height = Math.max(1, rect.height);
  const ctx = canvas.getContext("2d")!;
  ctx.translate(-rect.x, -rect.y);
  drawMagnifier(ctx, source, shape);
  return { png: await toPng(canvas), rect };
}

async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not render image");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * `area` of `image` reduced to one pixel per block of `size` pixels. Drawn
 * scaled up without smoothing, this is the pixelated look.
 */
export function pixelBlocks(image: HTMLImageElement, area: Rect, size: number): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.ceil(area.width / size));
  small.height = Math.max(1, Math.ceil(area.height / size));
  small
    .getContext("2d")!
    .drawImage(image, area.x, area.y, area.width, area.height, 0, 0, small.width, small.height);
  return small;
}

/** Draws `area` of `image` in blocks of `size` pixels. */
function pixelate(ctx: CanvasRenderingContext2D, image: HTMLImageElement, area: Rect, size: number) {
  if (area.width <= 0 || area.height <= 0) return;
  const small = pixelBlocks(image, area, size);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, area.x, area.y, area.width, area.height);
  ctx.restore();
}

/** Decodes PNG bytes into an image element. */
export function loadImage(bytes: ArrayBuffer | Uint8Array): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode image"));
    };
    img.src = url;
  });
}
