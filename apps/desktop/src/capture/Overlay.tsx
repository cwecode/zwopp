import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cancelCapture, finishCapture, overlayFrame, type Rect } from "../api";
import { useT } from "../i18n";

interface Point {
  x: number;
  y: number;
}

/** Drags shorter than this (in CSS px) count as a click. */
const CLICK_THRESHOLD = 4;

function toRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Full-screen selection overlay for one monitor. It shows the frozen frame
 * captured by the backend, so what the user selects is exactly what gets saved.
 */
export function Overlay({ index }: { index: number }) {
  const t = useT();
  const [src, setSrc] = useState<string>();
  const [start, setStart] = useState<Point>();
  const [current, setCurrent] = useState<Point>();
  const image = useRef<HTMLImageElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    let url: string | undefined;
    overlayFrame(index)
      .then((bytes) => {
        url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        setSrc(url);
      })
      .catch(() => cancelCapture());
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancelCapture();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (url) URL.revokeObjectURL(url);
    };
  }, [index]);

  const onLoad = async () => {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  };

  const finish = (selection: Rect) => {
    const img = image.current;
    if (!img || busy.current) return;
    busy.current = true;
    // CSS px -> frame px. Derived from the image itself so it is correct
    // regardless of how the OS scales this monitor.
    const sx = img.naturalWidth / img.clientWidth;
    const sy = img.naturalHeight / img.clientHeight;
    finishCapture(index, {
      x: Math.round(selection.x * sx),
      y: Math.round(selection.y * sy),
      width: Math.round(selection.width * sx),
      height: Math.round(selection.height * sy),
    }).catch(() => cancelCapture());
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return void cancelCapture();
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setStart({ x: e.clientX, y: e.clientY });
    setCurrent({ x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent) => setCurrent({ x: e.clientX, y: e.clientY });

  const onPointerUp = () => {
    if (!start || !current) return;
    const selection = toRect(start, current);
    setStart(undefined);
    if (selection.width < CLICK_THRESHOLD && selection.height < CLICK_THRESHOLD) {
      // A plain click captures the whole monitor.
      finish({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
    } else {
      finish(selection);
    }
  };

  const selection = start && current ? toRect(start, current) : undefined;
  const scale = image.current ? image.current.naturalWidth / image.current.clientWidth : 1;

  return (
    <div
      className="overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {src && <img ref={image} src={src} onLoad={onLoad} className="overlay-frame" draggable={false} />}
      {selection ? (
        <div
          className="overlay-selection"
          style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}
        >
          <span className="overlay-size">
            {Math.round(selection.width * scale)} × {Math.round(selection.height * scale)}
          </span>
        </div>
      ) : (
        <div className="overlay-dim">
          <p className="overlay-hint">{t.capture.hint}</p>
        </div>
      )}
      {current && !selection && (
        <>
          <div className="overlay-guide overlay-guide-h" style={{ top: current.y }} />
          <div className="overlay-guide overlay-guide-v" style={{ left: current.x }} />
        </>
      )}
    </div>
  );
}
