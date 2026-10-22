import { useEffect, useState, type ComponentProps } from "react";
import { Image as KonvaImage } from "react-konva";

type Props = Omit<ComponentProps<typeof KonvaImage>, "image"> & {
  source: HTMLImageElement | undefined;
  /** Device pixels per source pixel at the current zoom. */
  displayScale: number;
};

/**
 * Canvas `drawImage` downscales with a cheap filter, so a large screenshot
 * shown at 30 % looks jagged. This draws a high-quality pre-scaled copy
 * (power-of-two steps) instead. The full-resolution source stays available
 * as the node attribute `source` so exports can swap it back in.
 */
export function MipImage({ source, displayScale, ...props }: Props) {
  const mip = useMip(source, displayScale);
  return (
    <KonvaImage
      {...props}
      image={mip ?? source}
      width={props.width ?? source?.naturalWidth}
      height={props.height ?? source?.naturalHeight}
      source={source}
    />
  );
}

function useMip(source: HTMLImageElement | undefined, displayScale: number) {
  // Smallest power-of-two factor that still is at least the display scale,
  // so the copy is never upscaled on screen.
  const factor = displayScale >= 0.75 ? 1 : Math.pow(2, Math.ceil(Math.log2(Math.max(displayScale, 1 / 64))));
  const [mip, setMip] = useState<{ source: HTMLImageElement; factor: number; bitmap: ImageBitmap }>();

  useEffect(() => {
    if (!source || factor >= 1) return;
    let cancelled = false;
    createImageBitmap(source, {
      resizeWidth: Math.max(1, Math.ceil(source.naturalWidth * factor)),
      resizeHeight: Math.max(1, Math.ceil(source.naturalHeight * factor)),
      resizeQuality: "high",
    })
      .then((bitmap) => {
        if (cancelled) bitmap.close();
        else setMip({ source, factor, bitmap });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source, factor]);

  useEffect(() => () => mip?.bitmap.close(), [mip]);

  return mip && mip.source === source && mip.factor === factor && factor < 1 ? mip.bitmap : undefined;
}
