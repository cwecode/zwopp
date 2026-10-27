import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as api from "../api";
import type { LibraryItem } from "../api";
import { getClipboard, nextPasteOffset, setClipboard } from "./clipboard";
import { EditorCanvas, type CanvasHandle, type ZoomState } from "./EditorCanvas";
import { Filmstrip, type FilmstripHandle } from "./Filmstrip";
import { LayersPanel } from "./LayersPanel";
import {
  eraseArea,
  loadDocument,
  moveShapes,
  newId,
  removeShapes,
  visibleShapes,
  translateShape,
  updateShape,
  groupMembers,
  groupShapes,
  pruneGroups,
  selectedGroup,
  setGroupFrame,
  ungroup,
  arrowHeads,
  type ArrowHead,
  type EditorDocument,
  type FontFamily,
  type ImageShape,
  type Rect,
  type Shape,
} from "./document";
import { keys, useT } from "../i18n";
import { initHistory, push, redo, undo, type History } from "./history";
import { loadImage, renderBase } from "./render";
import {
  COLORS,
  FONTS,
  HEADS,
  HIGHLIGHT_COLOR,
  SIZES,
  TOOLS,
  stylePatch,
  toolOf,
  type ArrowHeads,
  type Tool,
  type ToolStyle,
} from "./tools";

export interface EditorHandle {
  /** Saves pending changes; call before leaving the editor. */
  flush(): Promise<void>;
}

interface Props {
  item: LibraryItem;
  onClose(): void;
  /** Switch the editor to another library item. */
  onOpen(item: LibraryItem): void;
  onSaved(item: LibraryItem): void;
}

type SaveStatus = "saved" | "pending" | "saving" | "error";

interface Asset {
  image: HTMLImageElement;
  bytes: Uint8Array;
}

const AUTOSAVE_DELAY = 700;
/** Clipboard key of the base screenshot in a "copy everything" block. */
const BASE_ASSET = "base";

const DEFAULT_STYLES: Record<Tool, ToolStyle> = {
  select: { color: COLORS[0], size: 1 },
  arrow: { color: COLORS[0], size: 1, heads: { start: "none", end: "filled" } },
  line: { color: COLORS[0], size: 1, heads: { start: "none", end: "none" } },
  rect: { color: COLORS[0], size: 1, filled: false },
  ellipse: { color: COLORS[0], size: 1, filled: false },
  text: { color: COLORS[0], size: 1, font: "sans", background: false },
  callout: { color: COLORS[4], size: 1, font: "sans" },
  step: { color: COLORS[0], size: 1 },
  highlight: { color: HIGHLIGHT_COLOR, size: 1 },
  blur: { color: COLORS[0], size: 1 },
};

/** A tiny line with the given heads, for the line-ends buttons. */
function HeadsIcon({ start, end }: ArrowHeads) {
  const head = (kind: ArrowHead, tip: number, dir: 1 | -1) =>
    kind === "none" ? null : (
      <path
        d={`M ${tip - dir * 7} 3 L ${tip} 8 L ${tip - dir * 7} 13${kind === "filled" ? " Z" : ""}`}
        fill={kind === "filled" ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    );
  return (
    <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden>
      <line x1="2" y1="8" x2="24" y2="8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {head(start, 2, -1)}
      {head(end, 24, 1)}
    </svg>
  );
}

function isTyping(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  return target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ item, onClose, onOpen, onSaved }, ref) {
  const t = useT();
  /** A key combination with this language's key names, e.g. "Strg+Z". */
  const k = (...combo: string[]) => keys(t, combo);
  const [image, setImage] = useState<HTMLImageElement>();
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [history, setHistory] = useState<History<EditorDocument>>();
  const [live, setLive] = useState<EditorDocument | null>(null);
  const [tool, setTool] = useState<Tool>("arrow");
  const [styles, setStyles] = useState(DEFAULT_STYLES);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [message, setMessage] = useState<string>();
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<ZoomState>({ zoom: 1, fit: true });
  const [activeLayerId, setActiveLayerId] = useState<string>();
  const [showLayers, setShowLayers] = useState(true);

  const canvas = useRef<CanvasHandle>(null);
  const filmstrip = useRef<FilmstripHandle>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  // Async code reads the latest state through refs.
  const historyRef = useRef(history);
  const liveRef = useRef(live);
  historyRef.current = history;
  liveRef.current = live;
  const savedDoc = useRef<EditorDocument>(undefined);
  const saving = useRef<Promise<void>>(undefined);
  const timer = useRef<number>(undefined);

  // Load the original image, the stored annotations and their assets.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [bytes, stored] = await Promise.all([api.readOriginal(item.id), api.loadDocument(item.id)]);
      const img = await loadImage(bytes);
      const doc = loadDocument(stored, img.naturalWidth, img.naturalHeight);
      const names = [...new Set(doc.objects.flatMap((s) => (s.type === "image" ? [s.asset] : [])))];
      const loaded: Record<string, Asset> = {};
      await Promise.all(
        names.map(async (name) => {
          try {
            const data = new Uint8Array(await api.readAsset(item.id, name));
            loaded[name] = { image: await loadImage(data), bytes: data };
          } catch {
            // A missing asset only leaves that one shape empty.
          }
        }),
      );
      if (cancelled) return;
      savedDoc.current = doc;
      setAssets(loaded);
      setHistory(initHistory(doc));
      setImage(img);
    })().catch((e) => setMessage(String(e)));
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setArea({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const save = useCallback((): Promise<void> => {
    if (saving.current) return saving.current.then(save);
    const target = historyRef.current?.present;
    if (!target || target === savedDoc.current) return Promise.resolve();
    setStatus("saving");
    saving.current = (async () => {
      try {
        await api.saveDocument(item.id, target);
        const png = await canvas.current!.exportPng();
        const updated = await api.saveRender(item.id, png);
        savedDoc.current = target;
        onSaved(updated);
        setStatus(historyRef.current?.present === target ? "saved" : "pending");
      } catch (e) {
        setStatus("error");
        setMessage(String(e));
      } finally {
        saving.current = undefined;
      }
    })();
    return saving.current;
  }, [item.id, onSaved]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    await save();
  }, [save]);

  useImperativeHandle(ref, () => ({ flush }), [flush]);

  // Autosave shortly after the last change, but never mid-drag.
  const present = history?.present;
  useEffect(() => {
    if (!present || present === savedDoc.current) return;
    setStatus("pending");
    const schedule = () => {
      timer.current = window.setTimeout(() => {
        if (liveRef.current) schedule();
        else save().then(() => historyRef.current?.present !== savedDoc.current && schedule());
      }, AUTOSAVE_DELAY);
    };
    schedule();
    return () => window.clearTimeout(timer.current);
  }, [present, save]);

  const commit = useCallback((next: EditorDocument) => {
    setLive(null);
    setHistory((h) => h && push(h, next));
  }, []);

  const doc = live ?? present;
  const selected = doc?.objects.filter((s) => selectedIds.includes(s.id)) ?? [];
  // New shapes go into the active layer; fall back to the top layer.
  const activeLayer =
    doc?.layers.find((l) => l.id === activeLayerId)?.id ?? doc?.layers[doc.layers.length - 1].id ?? "";

  /** Selects shapes and makes the layer of the first one active. */
  const select = useCallback(
    (ids: string[]) => {
      setSelectedIds(ids);
      const first = doc?.objects.find((s) => s.id === ids[0]);
      if (first) setActiveLayerId(first.layer);
    },
    [doc],
  );
  /** The block, if exactly one block is selected. */
  const block = doc ? selectedGroup(doc, selectedIds) : null;
  const canGroup = selected.length >= 2 && !block;
  // A framed block's colour and size controls style the frame (like a rectangle).
  const styleKey: Tool | "image" = block?.frame ? "rect" : selected[0] ? (toolOf(selected[0]) ?? "image") : tool;
  const style = styleKey === "image" ? styles.arrow : styles[styleKey];
  // Heads and fill show the selected shape's own, else the tool's defaults.
  const first = selected[0];
  const heads = first?.type === "arrow" ? arrowHeads(first) : style.heads;
  const filled = first?.type === "rect" || first?.type === "ellipse" ? first.fill !== undefined : style.filled;
  const font = first?.type === "text" ? (first.font ?? "sans") : style.font;
  const boxed = first?.type === "text" ? first.background !== undefined : style.background;

  const frameStyle = (s: ToolStyle) => {
    const width = SIZES[s.size].strokeWidth;
    return { stroke: s.color, strokeWidth: width, padding: 8 + width * 2 };
  };

  const changeStyle = (patch: Partial<ToolStyle>) => {
    if (styleKey !== "image") setStyles((s) => ({ ...s, [styleKey]: { ...s[styleKey], ...patch } }));
    if (!doc) return;
    if (block?.frame) {
      commit(setGroupFrame(doc, block.id, frameStyle({ ...styles.rect, ...patch })));
    } else if (selected.length) {
      commit(selected.reduce((d, shape) => updateShape(d, shape.id, stylePatch(shape, patch)), doc));
    }
  };

  const makeBlock = () => {
    if (!doc || !canGroup) return;
    const result = groupShapes(doc, selectedIds);
    if (!result) return;
    commit(result.doc);
    setSelectedIds(groupMembers(result.doc, result.id).map((s) => s.id));
  };

  const dissolveBlock = () => {
    if (doc && block) commit(ungroup(doc, block.id));
  };

  const toggleFrame = () => {
    if (doc && block) commit(setGroupFrame(doc, block.id, block.frame ? null : frameStyle(styles.rect)));
  };

  const chooseTool = (next: Tool) => {
    setTool(next);
    setMarquee(null);
    if (next !== "select") setSelectedIds([]);
  };

  /** Deletes the marked area, or else the selected shapes. */
  const deleteSelected = () => {
    if (!doc) return;
    if (marquee) {
      commit(eraseArea(doc, marquee));
      setMarquee(null);
    } else if (selectedIds.length) {
      commit(removeShapes(doc, selectedIds));
    }
    setSelectedIds([]);
  };

  const close = async () => {
    await flush();
    onClose();
  };

  const open = async (target: LibraryItem) => {
    if (target.id === item.id) return;
    await flush();
    onOpen(target);
  };

  /** Copies the annotated image to the system clipboard (for other apps). */
  const copyImage = async () => {
    try {
      await flush();
      await api.copyItem(item.id);
      setMessage(t.editor.imageCopied);
    } catch (e) {
      setMessage(String(e));
    }
  };

  /**
   * Copies the selected shapes, or — with nothing selected — the whole edit
   * (screenshot as an image shape plus all annotations), for pasting into
   * another screenshot. The whole edit also goes to the system clipboard.
   */
  const copy = async () => {
    if (!doc || !image) return;
    const assetBytes = (shapes: Shape[]) =>
      Object.fromEntries(
        shapes.flatMap((s) => (s.type === "image" && assets[s.asset] ? [[s.asset, assets[s.asset].bytes]] : [])),
      );
    // Blocks travel along if all their members are copied.
    const groupsOf = (shapes: Shape[]) =>
      doc.groups.filter((g) => {
        const members = doc.objects.filter((s) => s.group === g.id);
        return members.every((m) => shapes.some((s) => s.id === m.id));
      });
    try {
      if (selected.length) {
        setClipboard({
          sourceId: item.id,
          shapes: selected,
          groups: groupsOf(selected),
          assets: assetBytes(selected),
        });
        setMessage(t.editor.copiedShapes(selected.length, k("mod", "V")));
        return;
      }
      // Blur shapes are baked into the base image so hidden pixels never travel.
      const base = await renderBase(image, doc);
      const shapes = doc.objects.filter((s) => s.type !== "blur");
      const content = { sourceId: item.id, shapes, groups: groupsOf(shapes), assets: assetBytes(shapes) };
      if (base) {
        // The layer is assigned on paste.
        const baseShape: ImageShape = { id: newId(), layer: "", type: "image", ...base.rect, asset: BASE_ASSET };
        content.shapes = [baseShape, ...shapes];
        content.assets[BASE_ASSET] = base.png;
      }
      setClipboard(content);
      await copyImage();
      setMessage(t.editor.copiedAll(k("mod", "V")));
    } catch (e) {
      setMessage(String(e));
    }
  };

  /** Pastes the clipboard as a selected block that can be moved as a whole. */
  const paste = async () => {
    const content = getClipboard();
    if (!content || !doc) return;
    try {
      const names: Record<string, string> = {};
      const added: Record<string, Asset> = {};
      for (const [key, bytes] of Object.entries(content.assets)) {
        const name = await api.saveAsset(item.id, bytes);
        names[key] = name;
        added[name] = { image: await loadImage(bytes), bytes };
      }
      const offset = nextPasteOffset(item.id);
      const groupIds = new Map(content.groups.map((g) => [g.id, newId()]));
      const shapes = content.shapes.map((s) => {
        const copy = translateShape(
          { ...s, id: newId(), layer: activeLayer, group: s.group && groupIds.get(s.group) },
          offset,
          offset,
        );
        return copy.type === "image" ? { ...copy, asset: names[copy.asset] ?? copy.asset } : copy;
      });
      const groups = content.groups.map((g) => ({ ...g, id: groupIds.get(g.id)! }));
      const ids = shapes.map((s) => s.id);
      let next = pruneGroups({ ...doc, objects: [...doc.objects, ...shapes], groups: [...doc.groups, ...groups] });
      // Pasted content lands as one block in the active layer (a copied block stays as it is).
      if (ids.length >= 2 && !selectedGroup(next, ids)) next = groupShapes(next, ids)?.doc ?? next;
      setAssets((a) => ({ ...a, ...added }));
      commit(next);
      setTool("select");
      setMarquee(null);
      setSelectedIds(ids);
    } catch (e) {
      setMessage(String(e));
    }
  };

  const doUndo = () => {
    setLive(null);
    setHistory((h) => h && undo(h));
  };
  const doRedo = () => {
    setLive(null);
    setHistory((h) => h && redo(h));
  };

  const step = (direction: 1 | -1) => filmstrip.current?.step(direction);

  // Keyboard shortcuts. Re-bound every render so handlers see current state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z" && !e.shiftKey) doUndo();
      else if (mod && (key === "y" || (key === "z" && e.shiftKey))) doRedo();
      else if (mod && key === "c" && e.shiftKey) void copyImage();
      else if (mod && key === "c") void copy();
      else if (mod && key === "v") void paste();
      else if (mod && key === "g" && e.shiftKey) dissolveBlock();
      else if (mod && key === "g") makeBlock();
      else if (mod && key === "0") canvas.current?.fit();
      else if (mod && key === "1") canvas.current?.actualSize();
      else if (mod && (key === "+" || key === "=")) canvas.current?.zoomBy(1.25);
      else if (mod && key === "-") canvas.current?.zoomBy(0.8);
      else if (mod && key === "a") {
        setTool("select");
        const locked = new Set(doc?.layers.filter((l) => l.locked).map((l) => l.id));
        setSelectedIds(doc ? visibleShapes(doc).filter((s) => !locked.has(s.layer)).map((s) => s.id) : []);
      } else if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.code === "BracketRight" || e.code === "BracketLeft")) {
        if (!doc || !selectedIds.length) return;
        const up = e.key === "ArrowUp" || e.code === "BracketRight";
        commit(moveShapes(doc, selectedIds, e.shiftKey ? (up ? "front" : "back") : up ? "forward" : "backward"));
      } else if (e.altKey && e.key === "ArrowLeft") step(-1);
      else if (e.altKey && e.key === "ArrowRight") step(1);
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (e.key === "Escape") {
        setSelectedIds([]);
        setMarquee(null);
        setTool("select");
      } else if (!mod && !e.altKey) {
        const match = TOOLS.find((entry) => entry.key === key);
        if (match) chooseTool(match.id);
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const showColor = !["blur", "select", "image"].includes(styleKey);
  const showSize = !["highlight", "select", "image"].includes(styleKey);
  const showHeads = !block?.frame && (styleKey === "arrow" || styleKey === "line");
  const showFill = !block?.frame && (styleKey === "rect" || styleKey === "ellipse");
  const showFont = styleKey === "text" || styleKey === "callout";
  // A callout always has its bubble.
  const showTextBackground = styleKey === "text";
  const images = Object.fromEntries(Object.entries(assets).map(([name, a]) => [name, a.image]));

  return (
    <div className="editor">
      <header className="toolbar editor-toolbar">
        <button onClick={close} title={t.editor.backTitle}>
          ← {t.editor.back}
        </button>

        <div className="tool-group" role="toolbar" aria-label={t.editor.tools}>
          {TOOLS.map(({ id, key, icon }) => (
            <button
              key={id}
              className={tool === id ? "tool active" : "tool"}
              title={`${t.tools[id]} (${key.toUpperCase()})`}
              aria-pressed={tool === id}
              onClick={() => chooseTool(id)}
            >
              <span aria-hidden>{icon}</span>
              <span className="tool-label">{t.tools[id]}</span>
            </button>
          ))}
        </div>

        {(canGroup || block) && (
          <div className="tool-group" aria-label={t.editor.block}>
            {canGroup && (
              <button className="primary" onClick={makeBlock} title={`${t.editor.makeBlockTitle} (${k("mod", "G")})`}>
                {t.editor.makeBlock}
              </button>
            )}
            {block && (
              <>
                <button
                  className={block.frame ? "tool active" : "tool"}
                  aria-pressed={!!block.frame}
                  onClick={toggleFrame}
                  title={t.editor.frameTitle}
                >
                  ▢ {t.editor.frame}
                </button>
                <button onClick={dissolveBlock} title={`${t.editor.dissolveTitle} (${k("mod", "shift", "G")})`}>
                  {t.editor.dissolve}
                </button>
              </>
            )}
          </div>
        )}

        {showColor && (
          <div className="tool-group" aria-label={t.editor.color}>
            {COLORS.map((color) => (
              <button
                key={color}
                className={style.color === color ? "swatch active" : "swatch"}
                style={{ background: color }}
                title={color}
                aria-label={t.editor.colorOf(color)}
                onClick={() => changeStyle({ color })}
              />
            ))}
          </div>
        )}

        {showSize && (
          <div className="tool-group" aria-label={t.editor.size}>
            {SIZES.map((size, index) => (
              <button
                key={size.label}
                className={style.size === index ? "tool active" : "tool"}
                onClick={() => changeStyle({ size: index })}
              >
                {size.label}
              </button>
            ))}
          </div>
        )}

        {showHeads && (
          <div className="tool-group" aria-label={t.editor.heads}>
            {HEADS.map(({ id, start, end }) => {
              const active = heads?.start === start && heads?.end === end;
              return (
                <button
                  key={id}
                  className={active ? "tool active" : "tool"}
                  aria-pressed={active}
                  title={t.editor.headStyles[id]}
                  onClick={() => changeStyle({ heads: { start, end } })}
                >
                  <HeadsIcon start={start} end={end} />
                </button>
              );
            })}
          </div>
        )}

        {showFont && (
          <div className="tool-group" aria-label={t.editor.font}>
            {(Object.keys(FONTS) as FontFamily[]).map((family) => (
              <button
                key={family}
                className={font === family ? "tool active" : "tool"}
                aria-pressed={font === family}
                title={t.editor.fonts[family]}
                style={{ fontFamily: FONTS[family] }}
                onClick={() => changeStyle({ font: family })}
              >
                Ab
              </button>
            ))}
          </div>
        )}

        {showTextBackground && (
          <div className="tool-group" aria-label={t.editor.textBackground}>
            {[false, true].map((value) => (
              <button
                key={String(value)}
                className={!!boxed === value ? "tool active" : "tool"}
                aria-pressed={!!boxed === value}
                title={value ? t.editor.boxedText : t.editor.plainText}
                onClick={() => changeStyle({ background: value })}
              >
                <span className={value ? "text-boxed" : undefined}>T</span>
              </button>
            ))}
          </div>
        )}

        {showFill && (
          <div className="tool-group" aria-label={t.editor.fill}>
            {[false, true].map((value) => (
              <button
                key={String(value)}
                className={!!filled === value ? "tool active" : "tool"}
                aria-pressed={!!filled === value}
                title={value ? t.editor.filled : t.editor.outline}
                onClick={() => changeStyle({ filled: value })}
              >
                {styleKey === "ellipse" ? (value ? "●" : "○") : value ? "■" : "□"}
              </button>
            ))}
          </div>
        )}

        <div className="tool-group">
          <button onClick={doUndo} disabled={!history?.past.length} title={`${t.editor.undo} (${k("mod", "Z")})`}>
            ↶
          </button>
          <button onClick={doRedo} disabled={!history?.future.length} title={`${t.editor.redo} (${k("mod", "Y")})`}>
            ↷
          </button>
          <button
            className={marquee ? "danger" : undefined}
            onClick={deleteSelected}
            disabled={!selected.length && !marquee}
            title={`${t.editor.delete} (${k("del")})`}
          >
            {marquee ? t.editor.deleteArea : t.editor.delete}
          </button>
        </div>

        <div className="tool-group">
          <button onClick={copy} title={`${t.editor.copyTitle} (${k("mod", "C")})`}>
            {selected.length ? t.editor.copySelection : t.editor.copyAll}
          </button>
          <button onClick={paste} disabled={!getClipboard()} title={`${t.editor.paste} (${k("mod", "V")})`}>
            {t.editor.paste}
          </button>
        </div>

        <div className="tool-group" aria-label="Zoom">
          <button onClick={() => canvas.current?.zoomBy(0.8)} title={`${t.editor.zoomOut} (${k("mod", "−")}, ${k("mod", "wheel")})`}>
            −
          </button>
          <button
            className="zoom-level"
            onClick={() => canvas.current?.actualSize()}
            title={`${t.editor.actualSize} (${k("mod", "1")})`}
          >
            {Math.round(zoom.zoom * 100)} %
          </button>
          <button onClick={() => canvas.current?.zoomBy(1.25)} title={`${t.editor.zoomIn} (${k("mod", "+")}, ${k("mod", "wheel")})`}>
            +
          </button>
          <button
            className={zoom.fit ? "tool active" : "tool"}
            onClick={() => canvas.current?.fit()}
            title={`${t.editor.fitTitle} (${k("mod", "0")})`}
          >
            {t.editor.fit}
          </button>
        </div>

        <button
          className={showLayers ? "tool active" : "tool"}
          aria-pressed={showLayers}
          onClick={() => setShowLayers((v) => !v)}
          title={t.editor.layersTitle}
        >
          {t.editor.layers}
        </button>

        <span className={`save-status ${status}`}>{t.editor.status[status]}</span>
        <button className="primary" onClick={copyImage} title={`${t.editor.copyImageTitle} (${k("mod", "shift", "C")})`}>
          {t.editor.copyImage}
        </button>
      </header>

      {message && (
        <div className="notice" role="status">
          {message}
          <button onClick={() => setMessage(undefined)}>{t.ok}</button>
        </div>
      )}

      <div className="editor-body">
        <main className="editor-area" ref={areaRef}>
          {image && doc && present && area.width > 0 && (
            <EditorCanvas
              ref={canvas}
              image={image}
              assets={images}
              doc={doc}
              layoutDoc={present}
              tool={tool}
              styles={styles}
              selectedIds={selectedIds}
              activeLayer={activeLayer}
              marquee={marquee}
              width={area.width}
              height={area.height}
              onSelect={select}
              onMarquee={setMarquee}
              onPreview={setLive}
              onCommit={commit}
              onCancelPreview={() => setLive(null)}
              onZoom={setZoom}
            />
          )}
        </main>
        {showLayers && doc && (
          <LayersPanel
            doc={doc}
            selectedIds={selectedIds}
            activeLayer={activeLayer}
            onSelect={select}
            onActivate={setActiveLayerId}
            onCommit={commit}
          />
        )}
      </div>

      <Filmstrip ref={filmstrip} currentId={item.id} version={item.updatedAt} onOpen={open} />
    </div>
  );
});
