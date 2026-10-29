import { useRef, useState, type DragEvent } from "react";
import {
  addLayer,
  moveLayer,
  moveShapes,
  orderedShapes,
  placeShapes,
  removeLayer,
  updateLayer,
  type EditorDocument,
  type Layer,
  type Shape,
  type StackMove,
} from "./document";
import { keys, useT, type Messages } from "../i18n";
import { toolOf } from "./tools";

interface Props {
  doc: EditorDocument;
  selectedIds: string[];
  activeLayer: string;
  onSelect(ids: string[]): void;
  onActivate(layerId: string): void;
  onCommit(doc: EditorDocument): void;
}

const ICONS: Record<Shape["type"], string> = {
  arrow: "➚",
  rect: "▭",
  ellipse: "◯",
  step: "①",
  stamp: "🖱",
  emoji: "☺",
  magnify: "⌕",
  text: "T",
  highlight: "▬",
  blur: "▦",
  image: "▣",
};

const STACK_MOVES: { move: StackMove; icon: string; keys: string[] }[] = [
  { move: "front", icon: "⤒", keys: ["mod", "shift", "↑"] },
  { move: "forward", icon: "↑", keys: ["mod", "↑"] },
  { move: "backward", icon: "↓", keys: ["mod", "↓"] },
  { move: "back", icon: "⤓", keys: ["mod", "shift", "↓"] },
];

function label(t: Messages, shape: Shape) {
  if (shape.type === "text" && shape.text.trim()) {
    const text = shape.text.trim().replace(/\s+/g, " ");
    return t.quote(text.length > 24 ? `${text.slice(0, 24)}…` : text);
  }
  if (shape.type === "arrow" && toolOf(shape) === "line") return t.layers.shapes.line;
  if (shape.type === "text" && shape.tail) return t.layers.shapes.callout;
  if (shape.type === "step") return t.layers.shapes.step(shape.number);
  if (shape.type === "emoji") return t.layers.shapes.emoji(shape.emoji);
  if (shape.type === "stamp") return t.editor.stamps[shape.stamp] ?? t.layers.shapes.stamp;
  return t.layers.shapes[shape.type];
}

/** What is being dragged in the panel. */
type Drag = { kind: "layer"; id: string } | { kind: "shapes"; ids: string[] };

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/**
 * Layers like in an image editor: each layer lists its blocks and shapes, top
 * first. Shapes move between layers by drag and drop or with "Verschieben
 * nach"; the screenshot is the fixed background at the bottom.
 */
export function LayersPanel({ doc, selectedIds, activeLayer, onSelect, onActivate, onCommit }: Props) {
  const t = useT();
  // The drag source lives in a ref: re-rendering during `dragstart` can make
  // the webview cancel the drag. State only drives the drop highlight.
  const drag = useRef<Drag | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const shapes = orderedShapes(doc);
  const locked = new Set(doc.layers.filter((l) => l.locked).map((l) => l.id));
  const selectedShapes = shapes.filter((s) => selectedIds.includes(s.id));

  const startDrag = (event: DragEvent, next: Drag) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "zwopp");
    drag.current = next;
  };

  const allowDrop = (event: DragEvent, target: string, accepts: Drag["kind"][]) => {
    if (!drag.current || !accepts.includes(drag.current.kind)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (dropTarget !== target) setDropTarget(target);
  };

  const finishDrop = (event: DragEvent, apply: (dragged: Drag) => void) => {
    event.preventDefault();
    event.stopPropagation();
    if (drag.current) apply(drag.current);
    drag.current = null;
    setDropTarget(null);
  };

  const endDrag = () => {
    drag.current = null;
    setDropTarget(null);
  };

  /** Drop on a layer header: shapes go on top of it, a layer takes its place. */
  const dropOnLayer = (layer: Layer) => (dragged: Drag) => {
    if (dragged.kind === "shapes") {
      onCommit(placeShapes(doc, dragged.ids, layer.id, null));
      onActivate(layer.id);
    } else if (dragged.id !== layer.id) {
      onCommit(moveLayer(doc, dragged.id, doc.layers.findIndex((l) => l.id === layer.id)));
    }
  };

  /** Drop on a shape row: the dragged shapes go directly above it. */
  const dropOnShape = (target: Shape) => (dragged: Drag) => {
    if (dragged.kind === "shapes") onCommit(placeShapes(doc, dragged.ids, target.layer, target.id));
  };

  const moveSelectionTo = (layerId: string) => {
    if (!selectedIds.length) return;
    onCommit(placeShapes(doc, selectedIds, layerId, null));
    onActivate(layerId);
  };

  const add = () => {
    const { doc: next, id } = addLayer(doc, t.layers.newName);
    onCommit(next);
    onActivate(id);
  };

  const remove = (layer: Layer) => {
    const next = removeLayer(doc, layer.id);
    onCommit(next);
    onSelect(selectedIds.filter((id) => next.objects.some((s) => s.id === id)));
  };

  /** Click selects; Shift/Ctrl toggles. `ids` is one shape or a whole block. */
  const clickRow = (event: React.MouseEvent, ids: string[], layer: string) => {
    onActivate(layer);
    const isSelected = ids.every((id) => selectedIds.includes(id));
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      onSelect(isSelected ? selectedIds.filter((id) => !ids.includes(id)) : [...selectedIds, ...ids]);
    } else {
      onSelect(ids);
    }
  };

  const shapeRow = (shape: Shape, layer: Layer, inBlock: boolean) => (
    <li
      key={shape.id}
      className={classes(
        "shape-row",
        inBlock && "in-block",
        selectedIds.includes(shape.id) && "selected",
        dropTarget === shape.id && "drop",
        layer.locked && "locked",
      )}
      draggable={!layer.locked}
      onDragStart={(e) =>
        startDrag(e, { kind: "shapes", ids: selectedIds.includes(shape.id) ? selectedIds : [shape.id] })
      }
      onDragEnter={(e) => allowDrop(e, shape.id, ["shapes"])}
      onDragOver={(e) => allowDrop(e, shape.id, ["shapes"])}
      onDrop={(e) => finishDrop(e, dropOnShape(shape))}
      onDragEnd={endDrag}
      onClick={(e) => !layer.locked && clickRow(e, [shape.id], layer.id)}
    >
      <span className="shape-icon" aria-hidden>
        {ICONS[shape.type]}
      </span>
      {label(t, shape)}
    </li>
  );

  /** Shapes of a layer, top first; block members are listed under their block. */
  const layerContent = (layer: Layer) => {
    const children = shapes.filter((s) => s.layer === layer.id).reverse();
    const rows: React.ReactNode[] = [];
    const listed = new Set<string>();
    for (const shape of children) {
      if (!shape.group) {
        rows.push(shapeRow(shape, layer, false));
        continue;
      }
      if (listed.has(shape.group)) continue;
      listed.add(shape.group);
      const group = doc.groups.find((g) => g.id === shape.group);
      const members = children.filter((s) => s.group === shape.group);
      const ids = doc.objects.filter((s) => s.group === shape.group).map((s) => s.id);
      rows.push(
        <li
          key={`group:${shape.group}`}
          className={classes(
            "shape-row",
            "block-row",
            ids.every((id) => selectedIds.includes(id)) && "selected",
            layer.locked && "locked",
          )}
          draggable={!layer.locked}
          onDragStart={(e) => startDrag(e, { kind: "shapes", ids })}
          onDragEnd={endDrag}
          onClick={(e) => !layer.locked && clickRow(e, ids, layer.id)}
          title={t.layers.blockTitle}
        >
          <span className="shape-icon" aria-hidden>
            {group?.frame ? "▢" : "⧉"}
          </span>
          {group?.name ?? "Block"}
        </li>,
        ...members.map((m) => shapeRow(m, layer, true)),
      );
    }
    return rows;
  };

  return (
    <aside className="layers" aria-label={t.layers.title}>
      <header className="layers-header">
        <h2>{t.layers.title}</h2>
        <button onClick={add} title={t.layers.addTitle}>
          + {t.layers.add}
        </button>
      </header>

      <ol className="layers-list">
        {[...doc.layers].reverse().map((layer) => {
          const layerIds = shapes.filter((s) => s.layer === layer.id).map((s) => s.id);
          // The base layer holds the screenshot and stays at the bottom.
          const isBase = layer.id === doc.layers[0].id;
          const accepts: Drag["kind"][] = isBase ? ["shapes"] : ["layer", "shapes"];
          return (
            <li key={layer.id}>
              <div
                className={classes(
                  "layer-row",
                  layer.id === activeLayer && "active",
                  dropTarget === layer.id && "drop",
                  !layer.visible && "hidden",
                )}
                draggable={!isBase && renaming !== layer.id}
                onDragStart={(e) => startDrag(e, { kind: "layer", id: layer.id })}
                onDragEnter={(e) => allowDrop(e, layer.id, accepts)}
                onDragOver={(e) => allowDrop(e, layer.id, accepts)}
                onDrop={(e) => finishDrop(e, dropOnLayer(layer))}
                onDragEnd={endDrag}
                onClick={() => onActivate(layer.id)}
              >
                <button
                  className="icon"
                  title={layer.visible ? t.layers.hide : t.layers.show}
                  aria-pressed={layer.visible}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCommit(updateLayer(doc, layer.id, { visible: !layer.visible }));
                  }}
                >
                  {layer.visible ? "👁" : "◌"}
                </button>
                <button
                  className="icon"
                  title={layer.locked ? t.layers.unlock : t.layers.lock}
                  aria-pressed={layer.locked}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCommit(updateLayer(doc, layer.id, { locked: !layer.locked }));
                    if (!layer.locked) onSelect(selectedIds.filter((id) => !layerIds.includes(id)));
                  }}
                >
                  {layer.locked ? "🔒" : "🔓"}
                </button>
                {renaming === layer.id ? (
                  <input
                    className="layer-name-input"
                    autoFocus
                    defaultValue={layer.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== layer.name) onCommit(updateLayer(doc, layer.id, { name }));
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="layer-name" onDoubleClick={() => setRenaming(layer.id)} title={t.layers.rename}>
                    {layer.name}
                  </span>
                )}
                <button
                  className="icon"
                  title={t.layers.selectAll}
                  disabled={!layerIds.length || layer.locked}
                  onClick={(e) => {
                    e.stopPropagation();
                    onActivate(layer.id);
                    onSelect(layerIds);
                  }}
                >
                  ⬚
                </button>
                <button
                  className="icon"
                  title={isBase ? t.layers.baseStays : t.layers.delete}
                  disabled={isBase}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(layer);
                  }}
                >
                  ✕
                </button>
              </div>
              <ol className="layer-shapes">
                {layerContent(layer)}
                {isBase && (
                  <li className="shape-row background" title={t.layers.screenshotTitle}>
                    <span className="shape-icon" aria-hidden>
                      ▣
                    </span>
                    {t.layers.screenshot}
                  </li>
                )}
              </ol>
            </li>
          );
        })}
      </ol>

      <footer className="layers-footer" aria-label={t.layers.selection}>
        <label className="move-to">
          {t.layers.moveTo}
          <select
            value=""
            disabled={!selectedShapes.length || selectedShapes.some((s) => locked.has(s.layer))}
            onChange={(e) => moveSelectionTo(e.target.value)}
          >
            <option value="" disabled>
              {t.layers.chooseLayer}
            </option>
            {[...doc.layers].reverse().map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </label>
        <div className="stack-buttons">
          {STACK_MOVES.map(({ move, icon, keys: combo }) => (
            <button
              key={move}
              disabled={!selectedIds.length}
              title={`${t.layers.stack[move]} (${keys(t, combo)})`}
              onClick={() => onCommit(moveShapes(doc, selectedIds, move))}
            >
              {icon}
            </button>
          ))}
        </div>
      </footer>
    </aside>
  );
}
