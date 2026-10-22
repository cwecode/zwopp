import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  Arrow,
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Rect as KonvaRect,
  Stage,
  Text as KonvaText,
  Transformer,
} from "react-konva";
import {
  LINE_HEIGHT,
  addShape,
  contentBounds,
  imageBounds,
  newId,
  rectFromPoints,
  removeShape,
  unionRect,
  updateShape,
  type BlurShape,
  type EditorDocument,
  type Rect,
  type Shape,
  type TextShape,
} from "./document";
import { SIZES, type Tool, type ToolStyle } from "./tools";

export interface CanvasHandle {
  /** Renders image and shapes at full resolution, transparent where empty. */
  exportPng(): Promise<Uint8Array>;
}

interface Props {
  image: HTMLImageElement;
  /** What to draw (may contain a transient change). */
  doc: EditorDocument;
  /** Committed document; the zoom follows it so the view does not jump mid-drag. */
  layoutDoc: EditorDocument;
  tool: Tool;
  styles: Record<Tool, ToolStyle>;
  selectedId: string | null;
  /** Area marked with the selection tool, in image px. */
  marquee: Rect | null;
  /** Size of the stage, in CSS px. */
  width: number;
  height: number;
  onSelect(id: string | null): void;
  onMarquee(area: Rect | null): void;
  /** Transient change (while dragging/typing); not an undo step. */
  onPreview(doc: EditorDocument): void;
  /** Finished change; becomes an undo step. */
  onCommit(doc: EditorDocument): void;
  onCancelPreview(): void;
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

function makeShape(tool: Tool, id: string, a: Point, b: Point, style: ToolStyle): Shape | null {
  const size = SIZES[style.size];
  const rect = rectFromPoints(a.x, a.y, b.x, b.y);
  switch (tool) {
    case "arrow":
      return {
        id,
        type: "arrow",
        points: [a.x, a.y, b.x, b.y],
        stroke: style.color,
        strokeWidth: size.strokeWidth,
      };
    case "rect":
      return { id, type: "rect", ...rect, stroke: style.color, strokeWidth: size.strokeWidth };
    case "highlight":
      return { id, type: "highlight", ...rect, fill: style.color };
    case "blur":
      return { id, type: "blur", ...rect, pixelSize: size.pixelSize };
    default:
      return null;
  }
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

export const EditorCanvas = forwardRef<CanvasHandle, Props>(function EditorCanvas(props, ref) {
  const { image, doc, layoutDoc, tool, styles, selectedId, marquee, width, height } = props;
  const { onSelect, onMarquee, onPreview, onCommit, onCancelPreview } = props;

  const stageRef = useRef<Konva.Stage>(null);
  const contentRef = useRef<Konva.Layer>(null);
  const shapesRef = useRef<Konva.Group>(null);
  const boundsRef = useRef<Konva.Rect>(null);
  const checkerRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);

  const [draft, setDraft] = useState<Shape | null>(null);
  const [textDraft, setTextDraft] = useState<Rect | null>(null);
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null);
  const [draggingArrow, setDraggingArrow] = useState(false);

  // Fit the content (image + shapes) into the stage, centred, with a margin
  // around it so there is room to draw outside the current image.
  const layout = contentBounds(layoutDoc) ?? { x: 0, y: 0, ...doc.canvas };
  const scale = Math.max(
    0.05,
    Math.min(1, (width - MARGIN * 2) / layout.width, (height - MARGIN * 2) / layout.height),
  );
  const offsetX = Math.round(width / 2 - (layout.x + layout.width / 2) * scale);
  const offsetY = Math.round(height / 2 - (layout.y + layout.height / 2) * scale);
  const selected = doc.objects.find((s) => s.id === selectedId) ?? null;

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
    },
  }));

  // Outline and checkerboard behind the output area, so it is clear what will
  // be saved and which parts are transparent.
  useLayoutEffect(() => {
    const bounds = outputBounds();
    for (const node of [boundsRef.current, checkerRef.current]) {
      if (!node) continue;
      node.visible(!!bounds);
      if (bounds) node.setAttrs(bounds);
      node.getLayer()?.batchDraw();
    }
  });

  // Attach the transformer to the selected shape (arrows use end-point handles).
  useEffect(() => {
    const stage = stageRef.current;
    const transformer = transformerRef.current;
    if (!stage || !transformer) return;
    const node =
      selected && selected.type !== "arrow" && !editing
        ? stage.findOne((n: Konva.Node) => n.id() === selected.id)
        : undefined;
    transformer.nodes(node ? [node] : []);
    const isText = selected?.type === "text";
    transformer.keepRatio(isText);
    transformer.enabledAnchors(isText ? TEXT_ANCHORS : RECT_ANCHORS);
    transformer.getLayer()?.batchDraw();
  }, [selected, editing, doc]);

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
          x: isBox ? box.x : start.x,
          y: isBox ? box.y : start.y - (size.fontSize * LINE_HEIGHT) / 2,
          ...(isBox && { width: box.width }),
          text: "",
          fontSize: size.fontSize,
          fill: styles.text.color,
        };
        onPreview(addShape(doc, shape));
        onSelect(shape.id);
        setEditing({ id: shape.id, isNew: true });
      },
    );
  };

  const onStageMouseDown = (event: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage || editing || event.evt.button !== 0) return;
    const target = event.target;
    // Transformer and arrow handles drag themselves.
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
    onSelect(null);
    onMarquee(null);

    if (tool === "select") {
      trackDrag(
        stage,
        (p) => onMarquee(rectFromPoints(start.x, start.y, p.x, p.y)),
        (p) => {
          const area = rectFromPoints(start.x, start.y, p.x, p.y);
          const big = area.width * scale >= MIN_DRAG && area.height * scale >= MIN_DRAG;
          onMarquee(big ? area : null);
        },
      );
      return;
    }

    const id = newId();
    const style = styles[tool];
    setDraft(makeShape(tool, id, start, start, style));
    trackDrag(
      stage,
      (p) => setDraft(makeShape(tool, id, start, p, style)),
      (p) => {
        setDraft(null);
        const shape = makeShape(tool, id, start, p, style);
        const dx = Math.abs(p.x - start.x) * scale;
        const dy = Math.abs(p.y - start.y) * scale;
        const big = tool === "arrow" ? Math.hypot(dx, dy) >= MIN_DRAG : dx >= MIN_DRAG && dy >= MIN_DRAG;
        if (shape && big) {
          onCommit(addShape(doc, shape));
          // Keep the new shape selected so its handles show it can be adjusted.
          onSelect(id);
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
        onSelect(null);
      }
    } else if (!text) {
      onCommit(removeShape(doc, shape.id));
      onSelect(null);
    } else if (text !== shape.text) {
      onCommit(updateShape(doc, shape.id, { text }));
    }
  };

  const shapeProps = (shape: Shape) => ({
    id: shape.id,
    name: "shape",
    draggable: !editing,
    onMouseDown: () => {
      onSelect(shape.id);
      onMarquee(null);
    },
    onDragMove: (e: KonvaEventObject<DragEvent>) => {
      if (shape.type !== "arrow") onPreview(updateShape(doc, shape.id, { x: e.target.x(), y: e.target.y() }));
    },
    onDragEnd: (e: KonvaEventObject<DragEvent>) => {
      const node = e.target;
      if (shape.type === "arrow") {
        const [x1, y1, x2, y2] = shape.points;
        const [dx, dy] = [node.x(), node.y()];
        node.position({ x: 0, y: 0 });
        setDraggingArrow(false);
        onCommit(updateShape(doc, shape.id, { points: [x1 + dx, y1 + dy, x2 + dx, y2 + dy] }));
      } else {
        onCommit(updateShape(doc, shape.id, { x: node.x(), y: node.y() }));
      }
    },
    onTransform: (e: KonvaEventObject<Event>) => {
      // Side handles on text change the box width live instead of stretching glyphs.
      const node = e.target;
      if (shape.type === "text" && Math.abs(node.scaleY() - 1) < 1e-3) {
        node.setAttrs({ width: Math.max(20, node.width() * node.scaleX()), scaleX: 1 });
      }
    },
    onTransformEnd: (e: KonvaEventObject<Event>) => {
      const node = e.target;
      const [sx, sy] = [node.scaleX(), node.scaleY()];
      node.scale({ x: 1, y: 1 });
      if (shape.type === "text") {
        const resized =
          Math.abs(sy - 1) < 1e-3
            ? { width: node.width() * sx }
            : {
                fontSize: Math.max(6, shape.fontSize * sy),
                width: shape.width === undefined ? undefined : shape.width * sx,
              };
        onCommit(updateShape(doc, shape.id, { x: node.x(), y: node.y(), ...resized }));
      } else {
        onCommit(
          updateShape(doc, shape.id, {
            x: node.x(),
            y: node.y(),
            width: Math.max(2, node.width() * sx),
            height: Math.max(2, node.height() * sy),
          }),
        );
      }
    },
  });

  const renderShape = (shape: Shape, isDraft = false) => {
    const common = isDraft ? { listening: false } : shapeProps(shape);
    switch (shape.type) {
      case "arrow":
        return (
          <Arrow
            key={shape.id}
            {...common}
            onDragStart={() => setDraggingArrow(true)}
            points={shape.points}
            stroke={shape.stroke}
            fill={shape.stroke}
            strokeWidth={shape.strokeWidth}
            pointerLength={shape.strokeWidth * 3 + 6}
            pointerWidth={shape.strokeWidth * 3 + 6}
            lineCap="round"
            lineJoin="round"
            hitStrokeWidth={Math.max(16, shape.strokeWidth * 3)}
          />
        );
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
            fillEnabled={false}
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
            onDblClick={() => setEditing({ id: shape.id, isNew: false })}
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
    }
  };

  const editingShape = editing ? (doc.objects.find((s) => s.id === editing.id) as TextShape | undefined) : undefined;
  const anchors =
    selected?.type === "arrow" && !draggingArrow
      ? [0, 1].map((end) => (
          <Circle
            key={end}
            name="anchor"
            x={selected.points[end * 2]}
            y={selected.points[end * 2 + 1]}
            radius={6 / scale}
            fill="#fff"
            stroke={SELECTION}
            strokeWidth={1.5 / scale}
            draggable
            onDragMove={(e) => {
              const points = [...selected.points] as typeof selected.points;
              points[end * 2] = e.target.x();
              points[end * 2 + 1] = e.target.y();
              onPreview(updateShape(doc, selected.id, { points }));
            }}
            onDragEnd={() => onCommit(doc)}
          />
        ))
      : null;

  const cursor = tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";

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
      >
        <Layer listening={false}>
          <KonvaRect
            ref={checkerRef}
            fillPatternImage={CHECKER}
            fillPatternScale={{ x: 1 / scale, y: 1 / scale }}
          />
        </Layer>
        <Layer ref={contentRef}>
          <KonvaImage name="background" image={image} />
          {/* Deleted areas punch holes into the image only: shapes come later. */}
          {doc.erased.map((r, i) => (
            <KonvaRect key={i} {...r} fill="#000" globalCompositeOperation="destination-out" listening={false} />
          ))}
          <Group ref={shapesRef}>{doc.objects.map((shape) => renderShape(shape))}</Group>
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
            borderStroke={SELECTION}
            anchorStroke={SELECTION}
            anchorSize={8}
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

/** Pixelates the part of the original image underneath the shape. */
function BlurNode({
  shape,
  image,
  common,
}: {
  shape: BlurShape;
  image: HTMLImageElement;
  common: object;
}) {
  const node = useRef<Konva.Image>(null);
  const width = Math.max(1, shape.width);
  const height = Math.max(1, shape.height);

  useEffect(() => {
    const current = node.current;
    if (!current) return;
    current.cache();
    current.getLayer()?.batchDraw();
  }, [shape.x, shape.y, width, height, shape.pixelSize, image]);

  return (
    <KonvaImage
      ref={node}
      {...common}
      image={image}
      x={shape.x}
      y={shape.y}
      width={width}
      height={height}
      crop={{ x: shape.x, y: shape.y, width, height }}
      filters={[Konva.Filters.Pixelate]}
      pixelSize={shape.pixelSize}
    />
  );
}
