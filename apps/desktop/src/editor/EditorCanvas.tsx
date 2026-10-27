import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  Arrow,
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Rect as KonvaRect,
  Shape as KonvaShape,
  Stage,
  Text as KonvaText,
  Transformer,
} from "react-konva";
import {
  LINE_HEIGHT,
  addShape,
  arrowHeads,
  headSize,
  contentBounds,
  visibleShapes,
  imageBounds,
  newId,
  rectFromPoints,
  removeShapes,
  unionRect,
  updateShape,
  expandToGroups,
  type ArrowHead,
  type ArrowShape,
  type BlurShape,
  type EditorDocument,
  type Rect,
  type Shape,
  type TextShape,
} from "./document";
import { MipImage } from "./MipImage";
import { pixelBlocks } from "./render";
import { SIZES, type Tool, type ToolStyle } from "./tools";

export interface CanvasHandle {
  /** Renders image and shapes at full resolution, transparent where empty. */
  exportPng(): Promise<Uint8Array>;
  /** Zooms by `factor` around the centre of the view. */
  zoomBy(factor: number): void;
  /** Fits the content to the window, enlarging it to fill the available space. */
  fit(): void;
  /** One image pixel per screen pixel. */
  actualSize(): void;
}

/** Current zoom, where 1 means one image pixel per screen pixel. */
export interface ZoomState {
  zoom: number;
  fit: boolean;
}

interface Props {
  image: HTMLImageElement;
  /** Decoded images for `image` shapes, keyed by asset name. */
  assets: Record<string, HTMLImageElement>;
  /** What to draw (may contain a transient change). */
  doc: EditorDocument;
  /** Committed document; the zoom follows it so the view does not jump mid-drag. */
  layoutDoc: EditorDocument;
  tool: Tool;
  styles: Record<Tool, ToolStyle>;
  selectedIds: string[];
  /** Layer that receives new shapes. */
  activeLayer: string;
  /** Area marked with the selection tool, in image px. */
  marquee: Rect | null;
  /** Size of the stage, in CSS px. */
  width: number;
  height: number;
  onSelect(ids: string[]): void;
  onMarquee(area: Rect | null): void;
  /** Transient change (while dragging/typing); not an undo step. */
  onPreview(doc: EditorDocument): void;
  /** Finished change; becomes an undo step. */
  onCommit(doc: EditorDocument): void;
  onCancelPreview(): void;
  onZoom(state: ZoomState): void;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

/** Free space around the content so shapes can be drawn outside the image. */
const MARGIN = 80;
const FONT_FAMILY = "Inter, 'Segoe UI', system-ui, sans-serif";
const SELECTION = "#2f80ed";
/** Minimum drag distance in screen px before a drag counts. */
const MIN_DRAG = 4;
const RECT_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left",
];
const TEXT_ANCHORS = ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"];
const CORNER_ANCHORS = ["top-left", "top-right", "bottom-left", "bottom-right"];
/** Zoom limits relative to actual pixels. */
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 16;

function makeShape(
  tool: Tool,
  base: { id: string; layer: string },
  a: Point,
  b: Point,
  style: ToolStyle,
): Shape | null {
  const size = SIZES[style.size];
  const rect = rectFromPoints(a.x, a.y, b.x, b.y);
  switch (tool) {
    case "arrow":
    case "line": {
      const heads = style.heads ?? (tool === "line" ? { start: "none", end: "none" } : { start: "none", end: "filled" });
      return {
        ...base,
        type: "arrow",
        points: [a.x, a.y, b.x, b.y],
        stroke: style.color,
        strokeWidth: size.strokeWidth,
        startHead: heads.start,
        endHead: heads.end,
      };
    }
    case "rect":
    case "ellipse":
      return {
        ...base,
        type: tool,
        ...rect,
        stroke: style.color,
        strokeWidth: size.strokeWidth,
        ...(style.filled && { fill: style.color }),
      };
    case "highlight":
      return { ...base, type: "highlight", ...rect, fill: style.color };
    case "blur":
      return { ...base, type: "blur", ...rect, pixelSize: size.pixelSize };
    default:
      return null;
  }
}

/**
 * Draws a line with its heads: the shaft stops short of filled heads (so the
 * round cap cannot poke through the tip), open heads are two strokes meeting
 * at the end point. Used as the scene function of a Konva.Arrow, which keeps
 * computing the bounds (from `points` and the pointer size).
 */
function drawArrow(start: ArrowHead, end: ArrowHead) {
  return (ctx: Konva.Context, node: Konva.Shape) => {
    const [x1, y1, x2, y2] = node.getAttr("points") as number[];
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length === 0) return;
    const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
    const size = Math.min(headSize(node.strokeWidth()), length);
    const inset = (head: ArrowHead) => (head === "filled" ? size * 0.8 : 0);
    // Corners of a head at tip (tx, ty) pointing along (dx, dy).
    const corners = (tx: number, ty: number, dx: number, dy: number) => {
      const [bx, by] = [tx - dx * size, ty - dy * size];
      const [nx, ny] = [-dy * size * 0.5, dx * size * 0.5];
      return [bx + nx, by + ny, bx - nx, by - ny];
    };
    const heads: [ArrowHead, number, number, number, number][] = [
      [start, x1, y1, -ux, -uy],
      [end, x2, y2, ux, uy],
    ];

    ctx.beginPath();
    ctx.moveTo(x1 + ux * inset(start), y1 + uy * inset(start));
    ctx.lineTo(x2 - ux * inset(end), y2 - uy * inset(end));
    for (const [head, tx, ty, dx, dy] of heads) {
      if (head !== "open") continue;
      const [ax, ay, bx, by] = corners(tx, ty, dx, dy);
      ctx.moveTo(ax, ay);
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx, by);
    }
    ctx.strokeShape(node);

    if (start !== "filled" && end !== "filled") return;
    ctx.beginPath();
    for (const [head, tx, ty, dx, dy] of heads) {
      if (head !== "filled") continue;
      const [ax, ay, bx, by] = corners(tx, ty, dx, dy);
      ctx.moveTo(tx, ty);
      ctx.lineTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.closePath();
    }
    ctx.fillStrokeShape(node);
  };
}

/** An ellipse inside the node's width × height box, like a rectangle. */
function drawEllipse(ctx: Konva.Context, node: Konva.Shape) {
  const [rx, ry] = [node.width() / 2, node.height() / 2];
  ctx.beginPath();
  ctx.ellipse(rx, ry, rx, ry, 0, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStrokeShape(node);
}

/** Tracks a mouse drag on window level so it keeps working past the stage edge. */
function trackDrag(stage: Konva.Stage, onMove: (p: Point) => void, onUp: (p: Point) => void) {
  const toImage = (event: MouseEvent) => {
    stage.setPointersPositions(event);
    return stage.getRelativePointerPosition() ?? { x: 0, y: 0 };
  };
  const move = (event: MouseEvent) => onMove(toImage(event));
  const up = (event: MouseEvent) => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    onUp(toImage(event));
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function inside(outer: Rect, inner: Rect) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export const EditorCanvas = forwardRef<CanvasHandle, Props>(function EditorCanvas(props, ref) {
  const { image, assets, doc, layoutDoc, tool, styles, selectedIds, activeLayer, marquee, width, height } = props;
  const { onSelect, onMarquee, onPreview, onCommit, onCancelPreview, onZoom } = props;

  const stageRef = useRef<Konva.Stage>(null);
  const contentRef = useRef<Konva.Layer>(null);
  const shapesRef = useRef<Konva.Group>(null);
  const boundsRef = useRef<Konva.Rect>(null);
  const checkerRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  /** Set while a node commit is pending, so one gesture commits only once. */
  const committing = useRef(false);

  const [draft, setDraft] = useState<Shape | null>(null);
  const [textDraft, setTextDraft] = useState<Rect | null>(null);
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null);
  const [draggingArrow, setDraggingArrow] = useState(false);
  /** Block opened by double-click; its elements are then picked one by one. */
  const [enteredGroup, setEnteredGroup] = useState<string | null>(null);
  /**
   * Manual zoom/pan. null = fit, but never above 100 % (sharp default);
   * "fill" = fit and enlarge so the content fills the available space.
   */
  const [view, setView] = useState<View | "fill" | null>(null);
  const spaceDown = useRef(false);
  const [panning, setPanning] = useState(false);

  // Screenshots are captured in physical pixels; on a 150 % display one image
  // pixel at CSS scale 1 would be upscaled and blurry. Scale 1/dpr is 1:1.
  const dpr = window.devicePixelRatio || 1;
  const actual = 1 / dpr;

  // Fit the content (image + shapes) into the stage, centred, with a margin
  // around it so there is room to draw outside the current image.
  const layout = contentBounds(layoutDoc) ?? { x: 0, y: 0, ...doc.canvas };
  const fitTo = (limit: number): View => {
    const fitScale = Math.max(
      MIN_ZOOM * actual,
      Math.min(limit, (width - MARGIN * 2) / layout.width, (height - MARGIN * 2) / layout.height),
    );
    return {
      scale: fitScale,
      x: Math.round(width / 2 - (layout.x + layout.width / 2) * fitScale),
      y: Math.round(height / 2 - (layout.y + layout.height / 2) * fitScale),
    };
  };
  const current =
    view === "fill" ? fitTo(MAX_ZOOM * actual) : (view ?? fitTo(actual));
  const { scale } = current;
  const offsetX = current.x;
  const offsetY = current.y;

  useEffect(() => onZoom({ zoom: scale / actual, fit: view === "fill" }), [scale, actual, view, onZoom]);

  /** Zooms to `nextScale` keeping the screen point (px, py) fixed. */
  const zoomTo = (nextScale: number, px = width / 2, py = height / 2) => {
    const clamped = Math.min(MAX_ZOOM * actual, Math.max(MIN_ZOOM * actual, nextScale));
    const ratio = clamped / scale;
    setView({ scale: clamped, x: px - (px - offsetX) * ratio, y: py - (py - offsetY) * ratio });
  };

  const onWheel = (event: KonvaEventObject<WheelEvent>) => {
    const e = event.evt;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const pointer = stageRef.current?.getPointerPosition();
      zoomTo(scale * Math.pow(1.0015, -e.deltaY), pointer?.x, pointer?.y);
    } else {
      // Plain wheel pans; Shift turns vertical wheels into horizontal panning.
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      setView({ scale, x: offsetX - dx, y: offsetY - dy });
    }
  };

  const startPan = (e: MouseEvent) => {
    const base = { ...current, cx: e.clientX, cy: e.clientY };
    setPanning(true);
    const move = (ev: MouseEvent) =>
      setView({ scale: base.scale, x: base.x + ev.clientX - base.cx, y: base.y + ev.clientY - base.cy });
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setPanning(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Hold Space to pan with the left mouse button.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.tagName === "TEXTAREA";
    const down = (e: KeyboardEvent) => {
      if (e.key === " " && !typing(e)) {
        spaceDown.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  const selected = doc.objects.filter((s) => selectedIds.includes(s.id));
  const single = selected.length === 1 ? selected[0] : null;
  const locked = new Set(doc.layers.filter((l) => l.locked).map((l) => l.id));

  const findNode = (id: string) => stageRef.current?.findOne((n: Konva.Node) => n.id() === id);

  /**
   * Positions block frames around their members' current extent. Done on the
   * Konva nodes directly so frames follow while a block is being dragged.
   */
  const updateFrames = () => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const group of doc.groups) {
      const frame = findNode(`frame:${group.id}`);
      if (!frame || !group.frame) continue;
      const members = doc.objects
        .filter((s) => s.group === group.id)
        .map((s) => findNode(s.id))
        .filter((n): n is Konva.Node => !!n && n.isVisible());
      const box = members.reduce<Rect | null>(
        (acc, n) => unionRect(acc, n.getClientRect({ relativeTo: stage })),
        null,
      );
      frame.visible(!!box);
      if (box) {
        const pad = group.frame.padding;
        frame.setAttrs({ x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 });
      }
    }
    contentRef.current?.batchDraw();
  };

  /** Exact bounds of the output: what is left of the image plus all shapes. */
  const outputBounds = (): Rect | null => {
    const stage = stageRef.current;
    const shapes = shapesRef.current;
    let bounds = imageBounds(doc);
    if (stage && shapes?.hasChildren()) {
      bounds = unionRect(bounds, shapes.getClientRect({ relativeTo: stage }));
    }
    if (!bounds) return null;
    const x = Math.floor(bounds.x);
    const y = Math.floor(bounds.y);
    return {
      x,
      y,
      width: Math.ceil(bounds.x + bounds.width) - x,
      height: Math.ceil(bounds.y + bounds.height) - y,
    };
  };

  useImperativeHandle(ref, () => ({
    async exportPng() {
      const layer = contentRef.current;
      if (!layer) throw new Error("editor not ready");
      const area = outputBounds() ?? { x: 0, y: 0, width: 1, height: 1 };
      // Draw full-resolution sources instead of the screen-sized copies.
      const images = layer.find((n: Konva.Node) => !!n.getAttr("source")) as Konva.Image[];
      const shown = images.map((n) => n.image());
      images.forEach((n) => n.image(n.getAttr("source")));
      try {
        const blob = (await layer.toBlob({
          x: area.x * scale + offsetX,
          y: area.y * scale + offsetY,
          width: area.width * scale,
          height: area.height * scale,
          pixelRatio: 1 / scale,
          mimeType: "image/png",
        })) as Blob | null;
        if (!blob) throw new Error("export failed");
        return new Uint8Array(await blob.arrayBuffer());
      } finally {
        images.forEach((n, i) => n.image(shown[i]));
        layer.batchDraw();
      }
    },
    zoomBy: (factor) => zoomTo(scale * factor),
    fit: () => setView("fill"),
    actualSize: () => {
      const center = { x: (width / 2 - offsetX) / scale, y: (height / 2 - offsetY) / scale };
      setView({ scale: actual, x: width / 2 - center.x * actual, y: height / 2 - center.y * actual });
    },
  }));

  // Outline and checkerboard behind the output area, so it is clear what will
  // be saved and which parts are transparent.
  useLayoutEffect(() => {
    updateFrames();
    const bounds = outputBounds();
    for (const node of [boundsRef.current, checkerRef.current]) {
      if (!node) continue;
      node.visible(!!bounds);
      if (bounds) node.setAttrs(bounds);
      node.getLayer()?.batchDraw();
    }
  });

  // Attach the transformer to the selection. A single arrow uses its
  // end-point handles instead.
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const nodes =
      editing || single?.type === "arrow"
        ? []
        : selected.map((s) => findNode(s.id)).filter((n): n is Konva.Node => !!n);
    transformer.nodes(nodes);
    const isText = single?.type === "text";
    transformer.keepRatio(isText || selected.length > 1);
    transformer.enabledAnchors(isText ? TEXT_ANCHORS : selected.length > 1 ? CORNER_ANCHORS : RECT_ANCHORS);
    transformer.getLayer()?.batchDraw();
  });

  // Focus the text box once it is on screen.
  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      const input = textInput.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      autosize(input);
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  /**
   * Reads position and scale of the given shapes' nodes back into the
   * document as one undo step (after a drag or transform of the selection).
   */
  const commitNodes = (ids: string[]) => {
    if (committing.current) return;
    committing.current = true;
    setTimeout(() => (committing.current = false));
    let next = doc;
    for (const id of ids) {
      const shape = doc.objects.find((s) => s.id === id);
      const node = findNode(id);
      if (!shape || !node) continue;
      const [x, y, sx, sy] = [node.x(), node.y(), node.scaleX(), node.scaleY()];
      node.scale({ x: 1, y: 1 });
      let patch: Partial<Shape>;
      if (shape.type === "arrow") {
        // Arrows keep their geometry in `points`; fold the node transform in.
        node.position({ x: 0, y: 0 });
        const [x1, y1, x2, y2] = shape.points;
        patch = { points: [x + x1 * sx, y + y1 * sy, x + x2 * sx, y + y2 * sy] };
      } else if (shape.type === "text") {
        const boxed = node.getAttr("width") !== undefined;
        patch = {
          x,
          y,
          fontSize: Math.max(6, shape.fontSize * sy),
          width: boxed ? node.width() * sx : undefined,
        };
      } else {
        patch = { x, y, width: Math.max(2, shape.width * sx), height: Math.max(2, shape.height * sy) };
      }
      next = updateShape(next, id, patch);
    }
    setDraggingArrow(false);
    onCommit(next);
  };

  const startText = (start: Point) => {
    const stage = stageRef.current!;
    trackDrag(
      stage,
      (p) => setTextDraft(rectFromPoints(start.x, start.y, p.x, p.y)),
      (p) => {
        setTextDraft(null);
        const box = rectFromPoints(start.x, start.y, p.x, p.y);
        // A drag defines the box width; a click starts a box that grows with the text.
        const isBox = box.width * scale >= MIN_DRAG * 4;
        const size = SIZES[styles.text.size];
        const shape: TextShape = {
          id: newId(),
          type: "text",
          layer: activeLayer,
          x: isBox ? box.x : start.x,
          y: isBox ? box.y : start.y - (size.fontSize * LINE_HEIGHT) / 2,
          ...(isBox && { width: box.width }),
          text: "",
          fontSize: size.fontSize,
          fill: styles.text.color,
        };
        onPreview(addShape(doc, shape));
        onSelect([shape.id]);
        setEditing({ id: shape.id, isNew: true });
      },
    );
  };

  const onStageMouseDown = (event: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    // Middle mouse or Space + left mouse pans the view.
    if (event.evt.button === 1 || (event.evt.button === 0 && spaceDown.current)) {
      event.evt.preventDefault();
      startPan(event.evt);
      return;
    }
    if (editing || event.evt.button !== 0) return;
    const target = event.target;
    // Transformer (including its drag area) and arrow handles drag themselves.
    if (target.getParent() instanceof Konva.Transformer || target.name() === "anchor") return;
    const start = stage.getRelativePointerPosition();
    if (!start) return;
    const onShape = target.name() === "shape";

    if (tool === "text") {
      // Keep the browser from moving focus away from the text box we open.
      event.evt.preventDefault();
      if (onShape && target instanceof Konva.Text) setEditing({ id: target.id(), isNew: false });
      else if (!onShape) startText(start);
      return;
    }

    // Clicking a shape selects it (in every tool); the shape drags itself.
    if (onShape) return;
    onSelect([]);
    onMarquee(null);

    if (tool === "select") {
      trackDrag(
        stage,
        (p) => onMarquee(rectFromPoints(start.x, start.y, p.x, p.y)),
        (p) => {
          const area = rectFromPoints(start.x, start.y, p.x, p.y);
          if (area.width * scale < MIN_DRAG || area.height * scale < MIN_DRAG) {
            onMarquee(null);
            return;
          }
          onMarquee(area);
          // Shapes completely inside the area become the selection (whole blocks).
          setEnteredGroup(null);
          onSelect(
            expandToGroups(
              doc,
              visibleShapes(doc)
                .filter((s) => {
                  if (locked.has(s.layer)) return false;
                  const node = findNode(s.id);
                  return node && inside(area, node.getClientRect({ relativeTo: stage }));
                })
                .map((s) => s.id),
            ),
          );
        },
      );
      return;
    }

    const id = newId();
    const style = styles[tool];
    setDraft(makeShape(tool, { id, layer: activeLayer }, start, start, style));
    trackDrag(
      stage,
      (p) => setDraft(makeShape(tool, { id, layer: activeLayer }, start, p, style)),
      (p) => {
        setDraft(null);
        const shape = makeShape(tool, { id, layer: activeLayer }, start, p, style);
        const dx = Math.abs(p.x - start.x) * scale;
        const dy = Math.abs(p.y - start.y) * scale;
        const big =
          tool === "arrow" || tool === "line" ? Math.hypot(dx, dy) >= MIN_DRAG : dx >= MIN_DRAG && dy >= MIN_DRAG;
        if (shape && big) {
          onCommit(addShape(doc, shape));
          // Keep the new shape selected so its handles show it can be adjusted.
          onSelect([id]);
        }
      },
    );
  };

  const finishText = (value: string) => {
    if (!editing) return;
    const text = value.replace(/\s+$/, "");
    const shape = doc.objects.find((s) => s.id === editing.id) as TextShape | undefined;
    setEditing(null);
    if (!shape) return;
    if (editing.isNew) {
      if (text) onCommit(updateShape(doc, shape.id, { text }));
      else {
        onCancelPreview();
        onSelect([]);
      }
    } else if (!text) {
      onCommit(removeShapes(doc, [shape.id]));
      onSelect([]);
    } else if (text !== shape.text) {
      onCommit(updateShape(doc, shape.id, { text }));
    }
  };

  const shapeProps = (shape: Shape) => ({
    id: shape.id,
    name: "shape",
    draggable: !editing,
    onMouseDown: (e: KonvaEventObject<MouseEvent>) => {
      onMarquee(null);
      // A block is picked as a whole, unless it was entered by double-click.
      const unit =
        shape.group && shape.group !== enteredGroup
          ? doc.objects.filter((s) => s.group === shape.group).map((s) => s.id)
          : [shape.id];
      if (shape.group !== enteredGroup) setEnteredGroup(null);
      const isSelected = unit.every((id) => selectedIds.includes(id));
      if (e.evt.shiftKey) {
        onSelect(isSelected ? selectedIds.filter((id) => !unit.includes(id)) : [...selectedIds, ...unit]);
      } else if (!isSelected) {
        onSelect(unit);
      }
    },
    onDblClick: () => {
      if (shape.group && shape.group !== enteredGroup) {
        // Enter the block to edit a single element.
        setEnteredGroup(shape.group);
        onSelect([shape.id]);
      } else if (shape.type === "text") {
        setEditing({ id: shape.id, isNew: false });
      }
    },
    onDragStart: () => shape.type === "arrow" && setDraggingArrow(true),
    onDragMove: (e: KonvaEventObject<DragEvent>) => {
      // Live update for a single shape (keeps blur sampling under the shape).
      if (shape.type !== "arrow" && selectedIds.length <= 1) {
        onPreview(updateShape(doc, shape.id, { x: e.target.x(), y: e.target.y() }));
      }
      updateFrames();
    },
    onDragEnd: () => commitNodes(selectedIds.includes(shape.id) ? selectedIds : [shape.id]),
    onTransform: (e: KonvaEventObject<Event>) => {
      // Side handles on text change the box width live instead of stretching glyphs.
      const node = e.target;
      if (shape.type === "text" && Math.abs(node.scaleY() - 1) < 1e-3) {
        node.setAttrs({ width: Math.max(20, node.width() * node.scaleX()), scaleX: 1 });
      }
    },
  });

  const renderShape = (shape: Shape, isDraft = false) => {
    const common = isDraft || locked.has(shape.layer) ? { listening: false } : shapeProps(shape);
    switch (shape.type) {
      case "arrow":
        return <ArrowNode key={shape.id} common={common} shape={shape} />;
      case "rect":
        return (
          <KonvaRect
            key={shape.id}
            {...common}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            strokeScaleEnabled={false}
            cornerRadius={2}
            hitStrokeWidth={Math.max(16, shape.strokeWidth * 3)}
            fill={shape.fill}
            fillEnabled={shape.fill !== undefined}
          />
        );
      case "ellipse":
        return (
          <KonvaShape
            key={shape.id}
            {...common}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            strokeScaleEnabled={false}
            hitStrokeWidth={Math.max(16, shape.strokeWidth * 3)}
            fill={shape.fill}
            fillEnabled={shape.fill !== undefined}
            sceneFunc={drawEllipse}
          />
        );
      case "highlight":
        return (
          <KonvaRect
            key={shape.id}
            {...common}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            fill={shape.fill}
            globalCompositeOperation="multiply"
          />
        );
      case "text":
        return (
          <KonvaText
            key={shape.id}
            {...common}
            visible={editing?.id !== shape.id}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            wrap={shape.width === undefined ? "none" : "word"}
            text={shape.text}
            fontSize={shape.fontSize}
            fontFamily={FONT_FAMILY}
            fontStyle="bold"
            lineHeight={LINE_HEIGHT}
            fill={shape.fill}
          />
        );
      case "blur":
        return <BlurNode key={shape.id} common={common} shape={shape} image={image} />;
      case "image": {
        const source = assets[shape.asset];
        return (
          <MipImage
            key={shape.id}
            {...common}
            source={source}
            displayScale={source ? (scale * dpr * shape.width) / source.naturalWidth : 1}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
          />
        );
      }
    }
  };

  const editingShape = editing ? (doc.objects.find((s) => s.id === editing.id) as TextShape | undefined) : undefined;
  const anchors =
    single?.type === "arrow" && !draggingArrow
      ? [0, 1].map((end) => (
          <Circle
            key={end}
            name="anchor"
            x={single.points[end * 2]}
            y={single.points[end * 2 + 1]}
            radius={6 / scale}
            fill="#fff"
            stroke={SELECTION}
            strokeWidth={1.5 / scale}
            draggable
            onDragMove={(e) => {
              const points = [...single.points] as typeof single.points;
              points[end * 2] = e.target.x();
              points[end * 2 + 1] = e.target.y();
              onPreview(updateShape(doc, single.id, { points }));
            }}
            onDragEnd={() => onCommit(doc)}
          />
        ))
      : null;

  const cursor = panning ? "grabbing" : tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";

  return (
    <div className="editor-stage" style={{ cursor }}>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        scaleX={scale}
        scaleY={scale}
        x={offsetX}
        y={offsetY}
        onMouseDown={onStageMouseDown}
        onWheel={onWheel}
      >
        <Layer listening={false}>
          <KonvaRect
            ref={checkerRef}
            fillPatternImage={CHECKER}
            fillPatternScale={{ x: 1 / scale, y: 1 / scale }}
          />
        </Layer>
        <Layer ref={contentRef}>
          {/* The screenshot belongs to the base layer and is hidden with it. */}
          {doc.layers[0].visible && (
            <>
              <MipImage name="background" source={image} displayScale={scale * dpr} />
              {/* Deleted areas punch holes into the image only: shapes come later. */}
              {doc.erased.map((r, i) => (
                <KonvaRect key={i} {...r} fill="#000" globalCompositeOperation="destination-out" listening={false} />
              ))}
            </>
          )}
          <Group ref={shapesRef}>
            {visibleShapes(doc).map((shape) => renderShape(shape))}
            {doc.groups.map(
              (group) =>
                group.frame && (
                  <KonvaRect
                    key={group.id}
                    id={`frame:${group.id}`}
                    name="frame"
                    stroke={group.frame.stroke}
                    strokeWidth={group.frame.strokeWidth}
                    cornerRadius={4}
                    fillEnabled={false}
                    hitStrokeWidth={Math.max(16, group.frame.strokeWidth * 3)}
                    onMouseDown={(e) => {
                      // Clicking the frame picks the whole block.
                      e.cancelBubble = true;
                      setEnteredGroup(null);
                      onMarquee(null);
                      onSelect(doc.objects.filter((s) => s.group === group.id).map((s) => s.id));
                    }}
                  />
                ),
            )}
          </Group>
          {draft && renderShape(draft, true)}
        </Layer>
        <Layer>
          <KonvaRect
            ref={boundsRef}
            stroke="#8a8a8a"
            strokeWidth={1 / scale}
            dash={[4 / scale, 4 / scale]}
            listening={false}
          />
          {(marquee || textDraft) && (
            <KonvaRect
              {...(marquee ?? textDraft)!}
              stroke={SELECTION}
              strokeWidth={1 / scale}
              dash={[6 / scale, 4 / scale]}
              fill={marquee ? "rgba(47,128,237,0.12)" : undefined}
              listening={false}
            />
          )}
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            flipEnabled={false}
            ignoreStroke
            // With several shapes selected, drag the whole block from anywhere inside it.
            shouldOverdrawWholeArea={selected.length > 1}
            borderStroke={SELECTION}
            anchorStroke={SELECTION}
            anchorSize={8}
            onDragMove={updateFrames}
            onTransform={updateFrames}
            onDragEnd={() => commitNodes(selectedIds)}
            onTransformEnd={() => commitNodes(selectedIds)}
          />
          {anchors}
        </Layer>
      </Stage>
      {editing && editingShape && (
        <textarea
          ref={textInput}
          className={editingShape.width === undefined ? "editor-text-input" : "editor-text-input boxed"}
          defaultValue={editingShape.text}
          spellCheck={false}
          style={{
            left: editingShape.x * scale + offsetX,
            top: editingShape.y * scale + offsetY,
            width: editingShape.width === undefined ? undefined : editingShape.width * scale,
            fontSize: editingShape.fontSize * scale,
            fontFamily: FONT_FAMILY,
            lineHeight: LINE_HEIGHT,
            color: editingShape.fill,
          }}
          onInput={(e) => autosize(e.currentTarget)}
          onBlur={(e) => finishText(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
              e.currentTarget.blur();
            }
          }}
        />
      )}
    </div>
  );
});

/** 16 × 16 px checkerboard tile that marks transparent areas. */
const CHECKER = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = "#e4e4e4";
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(8, 8, 8, 8);
  return canvas as unknown as HTMLImageElement;
})();

/** Grows the text box with its content; boxed text only grows in height. */
function autosize(textarea: HTMLTextAreaElement) {
  const boxed = textarea.classList.contains("boxed");
  if (!boxed) textarea.style.width = "0";
  textarea.style.height = "0";
  if (!boxed) textarea.style.width = `${textarea.scrollWidth + 4}px`;
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/** A line with optional heads (see `drawArrow`). */
function ArrowNode({ shape, common }: { shape: ArrowShape; common: object }) {
  const { start, end } = arrowHeads(shape);
  const sceneFunc = useMemo(() => drawArrow(start, end), [start, end]);
  const size = headSize(shape.strokeWidth);
  return (
    <Arrow
      {...common}
      points={shape.points}
      stroke={shape.stroke}
      fill={shape.stroke}
      strokeWidth={shape.strokeWidth}
      // Only for the bounds; the heads are drawn by `sceneFunc`.
      pointerAtBeginning={start !== "none"}
      pointerAtEnding={end !== "none"}
      pointerLength={size}
      pointerWidth={size}
      lineCap="round"
      lineJoin="round"
      hitStrokeWidth={Math.max(16, shape.strokeWidth * 3)}
      sceneFunc={sceneFunc}
    />
  );
}

/**
 * Pixelates the part of the original image underneath the shape. Uses a plain
 * pre-computed bitmap (no Konva filter cache), so it can be clicked like any
 * other shape.
 */
function BlurNode({
  shape,
  image,
  common,
}: {
  shape: BlurShape;
  image: HTMLImageElement;
  common: object;
}) {
  const width = Math.max(1, shape.width);
  const height = Math.max(1, shape.height);
  const blocks = useMemo(
    () => pixelBlocks(image, { x: shape.x, y: shape.y, width, height }, shape.pixelSize),
    [image, shape.x, shape.y, width, height, shape.pixelSize],
  );
  return (
    <KonvaImage
      {...common}
      image={blocks}
      x={shape.x}
      y={shape.y}
      width={width}
      height={height}
      imageSmoothingEnabled={false}
    />
  );
}
