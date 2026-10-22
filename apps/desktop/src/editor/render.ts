// Off-screen rendering helpers that do not need the Konva stage.
import { imageBounds, type EditorDocument, type Rect } from "./document";

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
  const ctx = canvas.getContext("2d")!;
  ctx.translate(-bounds.x, -bounds.y);
  ctx.drawImage(image, 0, 0);
  for (const shape of doc.objects) {
    if (shape.type === "blur") pixelate(ctx, image, shape, shape.pixelSize);
  }
  for (const r of doc.erased) ctx.clearRect(r.x, r.y, r.width, r.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not render image");
  return { png: new Uint8Array(await blob.arrayBuffer()), rect: bounds };
}

/** Draws `area` of `image` in blocks of `size` pixels. */
function pixelate(ctx: CanvasRenderingContext2D, image: HTMLImageElement, area: Rect, size: number) {
  const x = Math.max(0, Math.floor(area.x));
  const y = Math.max(0, Math.floor(area.y));
  const width = Math.min(image.naturalWidth, Math.ceil(area.x + area.width)) - x;
  const height = Math.min(image.naturalHeight, Math.ceil(area.y + area.height)) - y;
  if (width <= 0 || height <= 0) return;
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.ceil(width / size));
  small.height = Math.max(1, Math.ceil(height / size));
  small.getContext("2d")!.drawImage(image, x, y, width, height, 0, 0, small.width, small.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, width, height);
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
