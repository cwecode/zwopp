import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cancelCapture, captureLayout, finishCapture, overlayFrame, type CaptureLayout, type Rect } from "../api";
import { useT } from "../i18n";

interface Point {
  x: number;
  y: number;
}

/** Drags shorter than this (in CSS px) count as a click. */
const CLICK_THRESHOLD = 4;
/** The magnifier shows this many image pixels across, each `ZOOM` CSS px wide. */
const LOUPE_PIXELS = 15;
const ZOOM = 8;
/** Every overlay draws the selection and the hovered target, whichever overlay has the mouse. */
const SELECTION_EVENT = "capture:selection";
const TARGET_EVENT = "capture:target";

function toRect(a: Point, b: Point): Rect {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.round(Math.abs(a.x - b.x)),
    height: Math.round(Math.abs(a.y - b.y)),
  };
}

const contains = (r: Rect, p: Point) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
const hex = (v: number) => v.toString(16).padStart(2, "0");

/**
 * Full-screen selection overlay for one monitor. It shows the frozen frame
 * captured by the backend, so what the user selects is exactly what gets
 * saved. Selections are in desktop pixels, so a drag may continue onto other
 * monitors: their overlays draw their part of it.
 */
export function Overlay({ index }: { index: number }) {
  const t = useT();
  const [src, setSrc] = useState<string>();
  const [layout, setLayout] = useState<CaptureLayout>();
  /** Selection being drawn, from whichever overlay has the mouse (desktop px). */
  const [selection, setSelection] = useState<Rect | null>(null);
  /** What a click would capture: the window under the mouse or a whole monitor. */
  const [target, setTarget] = useState<Rect | null>(null);
  /** Mouse position in this window (CSS px), while it is over this monitor. */
  const [pointer, setPointer] = useState<Point | null>(null);
  const [color, setColor] = useState<string>();
  const drag = useRef<{ start: Point; startClient: Point } | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const sampler = useRef<CanvasRenderingContext2D | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let url: string | undefined;
    Promise.all([overlayFrame(index), captureLayout()])
      .then(([bytes, layout]) => {
        url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        setLayout(layout);
        setSrc(url);
      })
      .catch(() => cancelCapture());
    const unlisten = Promise.all([
      listen<Rect | null>(SELECTION_EVENT, (e) => setSelection(e.payload)),
      listen<Rect | null>(TARGET_EVENT, (e) => setTarget(e.payload)),
    ]);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancelCapture();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      void unlisten.then((fns) => fns.forEach((fn) => fn()));
      if (url) URL.revokeObjectURL(url);
    };
  }, [index]);

  const monitor = layout?.monitors[index];
  /** Desktop (= frame) pixels per CSS pixel on this monitor. */
  const ratio = monitor ? monitor.width / window.innerWidth : 1;
  const toDesktop = (clientX: number, clientY: number): Point => ({
    x: (monitor?.x ?? 0) + clientX * ratio,
    y: (monitor?.y ?? 0) + clientY * ratio,
  });
  /** A desktop rectangle in this window's CSS px (may lie partly outside). */
  const toLocal = (r: Rect) => ({
    left: (r.x - (monitor?.x ?? 0)) / ratio,
    top: (r.y - (monitor?.y ?? 0)) / ratio,
    width: r.width / ratio,
    height: r.height / ratio,
  });

  const onThisMonitor = (r: Rect) =>
    !!monitor &&
    r.x < monitor.x + monitor.width &&
    r.y < monitor.y + monitor.height &&
    r.x + r.width > monitor.x &&
    r.y + r.height > monitor.y;

  const onLoad = async () => {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  };

  const share = (event: string, rect: Rect | null, current: Rect | null) => {
    if (!sameRect(rect, current)) void emit(event, rect);
  };

  /** The window under `p`, or with Shift (or over the bare desktop) the whole monitor. */
  const targetAt = (p: Point, wholeScreen: boolean): Rect | null => {
    if (!layout || !monitor) return null;
    return (!wholeScreen && layout.windows.find((w) => contains(w, p))) || monitor;
  };

  const finish = (rect: Rect) => {
    if (busy.current) return;
    busy.current = true;
    finishCapture(rect).catch(() => cancelCapture());
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return void cancelCapture();
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: toDesktop(e.clientX, e.clientY), startClient: { x: e.clientX, y: e.clientY } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // Only one overlay can have the focus; take it when the mouse arrives,
    // so the first click counts here and Esc works on this monitor.
    if (!document.hasFocus()) void getCurrentWindow().setFocus();
    const inside = e.clientX >= 0 && e.clientY >= 0 && e.clientX < window.innerWidth && e.clientY < window.innerHeight;
    setPointer(inside ? { x: e.clientX, y: e.clientY } : null);
    const p = toDesktop(e.clientX, e.clientY);
    const current = drag.current;
    if (current) {
      // Keeps receiving moves past the window edge (pointer capture), also over other monitors.
      const moved = Math.hypot(e.clientX - current.startClient.x, e.clientY - current.startClient.y) >= CLICK_THRESHOLD;
      const rect = moved ? toRect(current.start, p) : null;
      share(SELECTION_EVENT, rect, selection);
      setSelection(rect);
      return;
    }
    if (inside) {
      const next = targetAt(p, e.shiftKey);
      share(TARGET_EVENT, next, target);
      setTarget(next);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (selection && selection.width > 0 && selection.height > 0) {
      finish(selection);
    } else {
      // A click captures the window under the mouse, with Shift the whole monitor.
      const clicked = targetAt(toDesktop(e.clientX, e.clientY), e.shiftKey);
      if (clicked) finish(clicked);
    }
  };

  // Paint the magnifier: the pixels around the mouse, enlarged, with the
  // centre pixel framed; also read its colour.
  useEffect(() => {
    const img = image.current;
    const canvas = loupe.current;
    if (!pointer || !img || !canvas || !img.naturalWidth) return;
    const fx = Math.floor(pointer.x * (img.naturalWidth / img.clientWidth));
    const fy = Math.floor(pointer.y * (img.naturalHeight / img.clientHeight));
    const half = Math.floor(LOUPE_PIXELS / 2);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, fx - half, fy - half, LOUPE_PIXELS, LOUPE_PIXELS, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgb(255 255 255 / 0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(half * ZOOM + 0.5, half * ZOOM + 0.5, ZOOM - 1, ZOOM - 1);

    if (!sampler.current) {
      const pixel = document.createElement("canvas");
      pixel.width = pixel.height = 1;
      sampler.current = pixel.getContext("2d", { willReadFrequently: true });
    }
    const s = sampler.current!;
    s.clearRect(0, 0, 1, 1);
    s.drawImage(img, fx, fy, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = s.getImageData(0, 0, 1, 1).data;
    setColor(`#${hex(r)}${hex(g)}${hex(b)}`);
  }, [pointer]);

  const desktopPointer = pointer ? toDesktop(pointer.x, pointer.y) : null;
  const loupeSize = LOUPE_PIXELS * ZOOM;
  // Next to the mouse, flipped to the other side near the screen edges.
  const loupeLeft = pointer && pointer.x + 24 + loupeSize > window.innerWidth ? -24 - loupeSize : 24;
  const loupeTop = pointer && pointer.y + 24 + loupeSize + 40 > window.innerHeight ? -24 - loupeSize - 40 : 24;

  return (
    <div
      className="overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setPointer(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {src && <img ref={image} src={src} onLoad={onLoad} className="overlay-frame" draggable={false} />}
      {/* The dimming is the highlight's shadow, which only reaches this monitor if the highlight touches it. */}
      {selection ? (
        onThisMonitor(selection) ? (
          <div className="overlay-selection" style={toLocal(selection)}>
            <span className="overlay-size">
              {selection.width} × {selection.height}
            </span>
          </div>
        ) : (
          <div className="overlay-dim" />
        )
      ) : (
        <>
          {target && onThisMonitor(target) ? (
            <div className="overlay-target" style={toLocal(target)} />
          ) : (
            <div className="overlay-dim" />
          )}
          <p className="overlay-hint">{t.capture.hint}</p>
        </>
      )}
      {pointer && !selection && (
        <>
          <div className="overlay-guide overlay-guide-h" style={{ top: pointer.y }} />
          <div className="overlay-guide overlay-guide-v" style={{ left: pointer.x }} />
        </>
      )}
      {pointer && desktopPointer && (
        <div className="overlay-loupe" style={{ left: pointer.x + loupeLeft, top: pointer.y + loupeTop }}>
          <canvas ref={loupe} width={loupeSize} height={loupeSize} />
          <span>
            {Math.round(desktopPointer.x - (monitor?.x ?? 0))}, {Math.round(desktopPointer.y - (monitor?.y ?? 0))}
            {color && <> · {color}</>}
          </span>
        </div>
      )}
    </div>
  );
}
