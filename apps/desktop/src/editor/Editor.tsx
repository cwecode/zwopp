import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { LibraryItem } from "../api";
import { getClipboard, nextPasteOffset, setClipboard } from "./clipboard";
import { EditorCanvas, type CanvasHandle, type ZoomState } from "./EditorCanvas";
import { Filmstrip, type FilmstripHandle } from "./Filmstrip";
import { LayersPanel } from "./LayersPanel";
import {
  eraseArea,
  eraseMask,
  loadDocument,
  moveShapes,
  newId,
  removeShapes,
  visibleShapes,
  translateShape,
  updateShape,
  groupMembers,
  shapeBounds,
  groupShapes,
  pruneGroups,
  selectedGroup,
  setGroupFrame,
  ungroup,
  arrowHeads,
  type EditorDocument,
  type FontFamily,
  type ImageShape,
  type Rect,
  type Shape,
} from "./document";
import { keys, useT } from "../i18n";
import { initHistory, push, redo, undo, type History } from "./history";
import { cleanImage, loadImage, renderBase, renderMagnifier } from "./render";
import {
  COLORS,
  EMOJIS,
  FONTS,
  HEADS,
  MAX_STEP_NUMBER,
  SIZES,
  TOOLS,
  familyOf,
  stylePatch,
  toolOf,
  type Tool,
  type ToolStyle,
} from "./tools";
import {
  QUICK_STYLE_KEYS,
  initialStyles,
  quickStylesFor,
  readEditorSettings,
  sameStyle,
  styleFor,
} from "./quickStyles";
import { nextTip, pickTool, readGuide, type Guide } from "./guide";
import { STACK_MOVES } from "./LayersPanel";
import { DEFAULT_TOLERANCE, TOLERANCES, type Mask } from "./mask";
import { ContextMenu, Popover } from "./Popover";
import { ToolRail } from "./ToolRail";
import { STAMPS } from "./stamps";
import { HeadsIcon, StampIcon, StyleSwatch } from "./StyleIcons";
import { getSettings, updateEditorSettings, useSettings } from "../settings/store";

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

/** A button showing the chosen emoji; opens a grid to pick another. */
function EmojiPicker({ label, value, onPick }: { label: string; value?: string; onPick(emoji: string): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="tool-group emoji-picker" ref={root}>
      <button
        className="tool emoji-current"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {value ?? EMOJIS[0]} ▾
      </button>
      {open && (
        <div className="emoji-grid" role="listbox" aria-label={label}>
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              role="option"
              aria-selected={emoji === value}
              className={emoji === value ? "active" : undefined}
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
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
  // Each tool starts with its style from last time.
  const [styles, setStyles] = useState(() => initialStyles(readEditorSettings(getSettings().editor).toolStyles));
  const editorSettings = useSettings().editor;
  const quickStyles = useMemo(() => readEditorSettings(editorSettings).quickStyles, [editorSettings]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [wandSelection, setWandSelection] = useState<Mask | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [message, setMessage] = useState<string>();
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<ZoomState>({ zoom: 1, fit: true });
  const [activeLayerId, setActiveLayerId] = useState<string>();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // Style changes in this session, for the quick-styles tip.
  const [styleChanges, setStyleChanges] = useState(0);
  const guide = useMemo(() => readGuide(editorSettings), [editorSettings]);
  const updateGuide = (next: Guide) => updateEditorSettings({ guide: next }).catch((e) => setMessage(String(e)));

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
  const emoji = first?.type === "emoji" ? first.emoji : style.emoji;
  const stamp = first?.type === "stamp" ? first.stamp : style.stamp;
  const selectedSteps = selected.filter((s) => s.type === "step");
  const round = first?.type === "magnify" ? !!first.round : style.round;
  const font = first?.type === "text" ? (first.font ?? "sans") : style.font;
  const boxed = first?.type === "text" ? first.background !== undefined : style.background;

  const frameStyle = (s: ToolStyle) => {
    const width = SIZES[s.size].strokeWidth;
    return { stroke: s.color, strokeWidth: width, padding: 8 + width * 2 };
  };

  /** What the style controls show, as one style of the current tool. */
  const shownStyle: ToolStyle = { ...style, heads, filled, emoji, stamp, round, font, background: boxed };
  const toolQuickStyles =
    styleKey === "image" || styleKey === "select" || styleKey === "wand" ? [] : quickStylesFor(quickStyles, styleKey);

  const changeStyle = (patch: Partial<ToolStyle>) => {
    setStyleChanges((n) => n + 1);
    if (styleKey !== "image") {
      const next = { ...styles, [styleKey]: { ...styles[styleKey], ...patch } };
      setStyles(next);
      // Remembered for the next shape, also after a restart.
      const { select: _, ...toolStyles } = next;
      updateEditorSettings({ toolStyles }).catch((e) => setMessage(String(e)));
    }
    if (!doc) return;
    if (block?.frame) {
      commit(setGroupFrame(doc, block.id, frameStyle({ ...styles.rect, ...patch })));
    } else if (selected.length) {
      commit(selected.reduce((d, shape) => updateShape(d, shape.id, stylePatch(shape, patch)), doc));
    }
  };

  /**
   * The number control: with step badges selected it renumbers them, else it
   * sets the step tool's fixed number (undefined = counting up).
   */
  const setStepNumber = (number: number | undefined) => {
    if (selectedSteps.length) {
      if (doc && number !== undefined) {
        commit(selectedSteps.reduce((d, shape) => updateShape(d, shape.id, { number }), doc));
      }
    } else {
      changeStyle({ number });
    }
  };

  /** Saves what the style controls show as a new quick style of the current tool. */
  const saveQuickStyle = () => {
    if (styleKey === "image" || styleKey === "select") return;
    const names = new Set(quickStyles.map((q) => q.name));
    let n = toolQuickStyles.length + 1;
    while (names.has(t.editor.quickStyleName(t.tools[styleKey], n))) n++;
    const name = t.editor.quickStyleName(t.tools[styleKey], n);
    const added = { id: newId(), name, tool: styleKey, style: styleFor(styleKey, shownStyle) };
    updateEditorSettings({ quickStyles: [...quickStyles, added] })
      .then(() => setMessage(t.editor.quickStyleSaved(name)))
      .catch((e) => setMessage(String(e)));
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
    // Counted, and shown in front of its family from now on.
    updateGuide(pickTool(guide, next, familyOf(next).id));
    setTool(next);
    setMarquee(null);
    setWandSelection(null);
    if (next !== "select") setSelectedIds([]);
  };

  /** Applies the wand selection: deletes it, or with `keep` everything else. */
  const eraseWand = (keep: boolean) => {
    if (!doc || !wandSelection) return;
    commit(eraseMask(doc, wandSelection, keep));
    setWandSelection(null);
  };

  /** Deletes the wand selection or the marked area, or else the selected shapes. */
  const deleteSelected = () => {
    if (!doc) return;
    if (wandSelection) {
      eraseWand(false);
    } else if (marquee) {
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
  /** Saves the annotated image as a file the user picks. */
  const exportFile = async () => {
    try {
      await flush();
      const path = await api.exportItem(item.id, t.library.exportDialog);
      if (path) setMessage(t.library.exported(path));
    } catch (e) {
      setMessage(String(e));
    }
  };

  /** Drags the annotated image into another app (from `dragstart`). */
  const dragImage = async () => {
    try {
      await flush();
      await api.dragOut(item.id);
    } catch (e) {
      setMessage(String(e));
    }
  };

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
    // Magnifiers travel as pictures: in another screenshot their source
    // would show other pixels.
    const portable = async (shapes: Shape[]) => {
      const pictures: Record<string, Uint8Array> = {};
      const clean = shapes.some((s) => s.type === "magnify") ? cleanImage(image, doc) : null;
      const converted = await Promise.all(
        shapes.map(async (s): Promise<Shape> => {
          if (s.type !== "magnify" || !clean) return s;
          const picture = await renderMagnifier(clean, s, shapeBounds(s));
          const asset = `magnify-${s.id}`;
          pictures[asset] = picture.png;
          return { id: s.id, layer: s.layer, group: s.group, type: "image", ...picture.rect, asset };
        }),
      );
      return { shapes: converted, assets: { ...assetBytes(converted), ...pictures } };
    };
    try {
      if (selected.length) {
        const copied = await portable(selected);
        setClipboard({
          sourceId: item.id,
          shapes: copied.shapes,
          groups: groupsOf(selected),
          assets: copied.assets,
        });
        setMessage(t.editor.copiedShapes(selected.length, k("mod", "V")));
        return;
      }
      // Blur shapes are baked into the base image so hidden pixels never travel.
      const base = await renderBase(image, doc);
      const copied = await portable(doc.objects.filter((s) => s.type !== "blur"));
      const shapes = copied.shapes;
      const content = { sourceId: item.id, shapes, groups: groupsOf(shapes), assets: copied.assets };
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
      else if (mod && key === "s" && e.shiftKey) void exportFile();
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
        setWandSelection(null);
        setTool("select");
      } else if (!mod && !e.altKey && /^[1-9]$/.test(e.key)) {
        const quick = toolQuickStyles[Number(e.key) - 1];
        if (quick) changeStyle(quick.style);
        else return;
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

  const showColor = !["blur", "select", "image", "emoji", "wand"].includes(styleKey);
  const showSize = !["highlight", "select", "image", "fill", "wand"].includes(styleKey);
  const showTolerance = styleKey === "fill" || styleKey === "wand";
  const showHeads = !block?.frame && (styleKey === "arrow" || styleKey === "line");
  const showFill = !block?.frame && (styleKey === "rect" || styleKey === "ellipse");
  const showFont = styleKey === "text" || styleKey === "callout";
  // A callout always has its bubble.
  const showTextBackground = styleKey === "text";
  const showEmoji = styleKey === "emoji";
  const showStamp = styleKey === "stamp";
  const showNumbering = styleKey === "step";
  // A selected badge shows its own number; the tool its fixed one, if any.
  const shownNumber = selectedSteps[0]?.type === "step" ? selectedSteps[0].number : style.number;
  const clampNumber = (n: number) => Math.min(MAX_STEP_NUMBER, Math.max(1, Math.round(n)));
  const showMagnifierShape = styleKey === "magnify";
  const images = Object.fromEntries(Object.entries(assets).map(([name, a]) => [name, a.image]));

  // Options that are not needed every time go behind "More".
  const moreOptions = [
    showHeads && (
      <div key="heads" className="tool-group" aria-label={t.editor.heads}>
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
    ),
    showFill && (
      <div key="fill" className="tool-group" aria-label={t.editor.fill}>
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
    ),
    showFont && (
      <div key="font" className="tool-group" aria-label={t.editor.font}>
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
    ),
    showTextBackground && (
      <div key="background" className="tool-group" aria-label={t.editor.textBackground}>
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
    ),
    showTolerance && (
      <div key="tolerance" className="tool-group" aria-label={t.editor.tolerance}>
        <span className="tool-group-label">{t.editor.tolerance}</span>
        {TOLERANCES.map((value, index) => {
          const active = (style.tolerance ?? DEFAULT_TOLERANCE) === index;
          return (
            <button
              key={value}
              className={active ? "tool active" : "tool"}
              aria-pressed={active}
              title={t.editor.toleranceTitle(value)}
              onClick={() => changeStyle({ tolerance: index })}
            >
              {t.editor.toleranceLabels[index]}
            </button>
          );
        })}
      </div>
    ),
    showNumbering && !selectedSteps.length && (
      <div key="numbering" className="tool-group" aria-label={t.editor.numbering}>
        {[false, true].map((fixed) => {
          const active = (style.number !== undefined) === fixed;
          return (
            <button
              key={String(fixed)}
              className={active ? "tool active" : "tool"}
              aria-pressed={active}
              title={fixed ? t.editor.fixedNumberTitle : t.editor.countingTitle}
              onClick={() => setStepNumber(fixed ? (style.number ?? 1) : undefined)}
            >
              {fixed ? t.editor.fixedNumber : t.editor.counting}
            </button>
          );
        })}
      </div>
    ),
    showMagnifierShape && (
      <div key="magnifier" className="tool-group" aria-label={t.editor.magnifierShape}>
        {[false, true].map((value) => (
          <button
            key={String(value)}
            className={!!round === value ? "tool active" : "tool"}
            aria-pressed={!!round === value}
            title={value ? t.editor.round : t.editor.square}
            onClick={() => changeStyle({ round: value })}
          >
            {value ? "○" : "▢"}
          </button>
        ))}
      </div>
    ),
  ].filter(Boolean);
  const canSaveQuickStyle = styleKey !== "image" && styleKey !== "select" && styleKey !== "wand";
  const tip =
    doc &&
    nextTip(guide, {
      tool,
      steps: doc.objects.filter((s) => s.type === "step").length,
      styleChanges,
    });

  return (
    <div className="editor">
      <header className="toolbar editor-toolbar">
        <button onClick={close} title={t.editor.backTitle}>
          ← {t.editor.back}
        </button>

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

        {showEmoji && <EmojiPicker label={t.editor.emoji} value={emoji} onPick={(e) => changeStyle({ emoji: e })} />}

        {showStamp && (
          <div className="tool-group" role="listbox" aria-label={t.editor.stamp}>
            {STAMPS.map((kind) => (
              <button
                key={kind}
                role="option"
                aria-selected={stamp === kind}
                className={stamp === kind ? "tool active" : "tool"}
                title={t.editor.stamps[kind]}
                aria-label={t.editor.stamps[kind]}
                onClick={() => changeStyle({ stamp: kind })}
              >
                <StampIcon kind={kind} color={style.color} />
              </button>
            ))}
          </div>
        )}

        {styleKey === "wand" && (
          <div className="tool-group" aria-label={t.tools.wand}>
            {wandSelection ? (
              <>
                <button className="primary" title={t.editor.wandKeepTitle} onClick={() => eraseWand(true)}>
                  {t.editor.wandKeep}
                </button>
                <button title={t.editor.wandDeleteTitle} onClick={() => eraseWand(false)}>
                  {t.editor.wandDelete}
                </button>
                <button onClick={() => setWandSelection(null)}>{t.editor.wandClear}</button>
              </>
            ) : (
              <span className="tool-group-label">{t.editor.wandHint}</span>
            )}
          </div>
        )}

        {showNumbering && shownNumber !== undefined && (
          <div className="tool-group" aria-label={t.editor.stepNumber}>
            <button
              className="tool"
              title={t.editor.lower}
              aria-label={t.editor.lower}
              disabled={shownNumber <= 1}
              onClick={() => setStepNumber(clampNumber(shownNumber - 1))}
            >
              −
            </button>
            <input
              className="step-number"
              type="number"
              min={1}
              max={MAX_STEP_NUMBER}
              aria-label={t.editor.stepNumber}
              value={shownNumber}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value >= 1) setStepNumber(clampNumber(value));
              }}
            />
            <button
              className="tool"
              title={t.editor.higher}
              aria-label={t.editor.higher}
              disabled={shownNumber >= MAX_STEP_NUMBER}
              onClick={() => setStepNumber(clampNumber(shownNumber + 1))}
            >
              +
            </button>
          </div>
        )}

        {toolQuickStyles.length > 0 && (
          <div className="tool-group quick-styles" aria-label={t.editor.quickStyles}>
            {toolQuickStyles.map((quick, index) => {
              const active = sameStyle(styleKey as Tool, shownStyle, quick.style);
              return (
                <button
                  key={quick.id}
                  className={active ? "tool active" : "tool"}
                  aria-pressed={active}
                  title={index < QUICK_STYLE_KEYS ? t.editor.applyQuickStyle(quick.name, String(index + 1)) : quick.name}
                  onClick={() => changeStyle(quick.style)}
                >
                  <StyleSwatch tool={styleKey as Tool} style={quick.style} />
                </button>
              );
            })}
          </div>
        )}

        {(moreOptions.length > 0 || canSaveQuickStyle) && (
          <Popover className="tool" label={`${t.editor.more} ▾`} title={t.editor.moreTitle}>
            <div className="more-options">
              {moreOptions}
              {canSaveQuickStyle && (
                <button onClick={saveQuickStyle} title={t.editor.saveQuickStyle}>
                  + {t.editor.saveAsQuickStyle}
                </button>
              )}
            </div>
          </Popover>
        )}

        {(canGroup || block) && (
          <div className="tool-group" aria-label={t.editor.block}>
            {canGroup && (
              <button onClick={makeBlock} title={`${t.editor.makeBlockTitle} (${k("mod", "G")})`}>
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

        {(selected.length > 0 || marquee) && (
          <button
            className={marquee ? "danger" : undefined}
            onClick={deleteSelected}
            title={`${t.editor.delete} (${k("del")})`}
          >
            {marquee ? t.editor.deleteArea : t.editor.delete}
          </button>
        )}

        <span className="spacer" />

        <div className="tool-group">
          <button onClick={doUndo} disabled={!history?.past.length} title={`${t.editor.undo} (${k("mod", "Z")})`}>
            ↶
          </button>
          <button onClick={doRedo} disabled={!history?.future.length} title={`${t.editor.redo} (${k("mod", "Y")})`}>
            ↷
          </button>
        </div>

        <Popover className="zoom-level" label={`${Math.round(zoom.zoom * 100)} %`} title={t.editor.zoom} align="right">
          {(closeMenu) => (
            <div className="menu">
              <button onClick={() => (canvas.current?.fit(), closeMenu())}>
                {t.editor.fitTitle} <kbd>{k("mod", "0")}</kbd>
              </button>
              <button onClick={() => (canvas.current?.actualSize(), closeMenu())}>
                {t.editor.actualSize} <kbd>{k("mod", "1")}</kbd>
              </button>
              <button onClick={() => canvas.current?.zoomBy(1.25)}>
                {t.editor.zoomIn} <kbd>{k("mod", "+")}</kbd>
              </button>
              <button onClick={() => canvas.current?.zoomBy(0.8)}>
                {t.editor.zoomOut} <kbd>{k("mod", "−")}</kbd>
              </button>
            </div>
          )}
        </Popover>

        <button
          className={guide.showLayers ? "tool active" : "tool"}
          aria-pressed={guide.showLayers}
          onClick={() => updateGuide({ ...guide, showLayers: !guide.showLayers })}
          title={t.editor.layersTitle}
        >
          {t.editor.layers}
        </button>

        <span className={`save-status ${status}`}>{t.editor.status[status]}</span>

        <Popover label={`${t.editor.share} ▾`} title={t.editor.shareTitle} align="right">
          {(closeMenu) => (
            <div className="menu">
              <button onClick={() => (void copyImage(), closeMenu())}>
                {t.editor.copyImage} <kbd>{k("mod", "shift", "C")}</kbd>
              </button>
              <button onClick={() => (void exportFile(), closeMenu())}>
                {t.editor.export} <kbd>{k("mod", "shift", "S")}</kbd>
              </button>
              <button
                draggable
                title={t.editor.dragTitle}
                onDragStart={(e) => {
                  e.preventDefault();
                  closeMenu();
                  void dragImage();
                }}
              >
                ⠿ {t.editor.dragOut}
              </button>
            </div>
          )}
        </Popover>
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
        <ToolRail
          tool={tool}
          guide={guide}
          onPick={chooseTool}
          onOpenFamily={(family) =>
            !guide.openedFamilies.includes(family) &&
            updateGuide({ ...guide, openedFamilies: [...guide.openedFamilies, family] })
          }
        />
        <main
          className="editor-area"
          ref={areaRef}
          onContextMenu={(e) => {
            e.preventDefault();
            const bounds = e.currentTarget.getBoundingClientRect();
            setContextMenu({ x: e.clientX - bounds.left, y: e.clientY - bounds.top });
          }}
        >
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
              wandSelection={wandSelection}
              onWandSelect={setWandSelection}
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
          {contextMenu && (
            <ContextMenu at={contextMenu} onClose={() => setContextMenu(null)}>
              <button onClick={copy} disabled={!doc}>
                {selected.length ? t.editor.copySelection : t.editor.copyAll} <kbd>{k("mod", "C")}</kbd>
              </button>
              <button onClick={paste} disabled={!getClipboard()}>
                {t.editor.paste} <kbd>{k("mod", "V")}</kbd>
              </button>
              {(selected.length > 0 || marquee) && (
                <button onClick={deleteSelected}>
                  {marquee ? t.editor.deleteArea : t.editor.delete} <kbd>{k("del")}</kbd>
                </button>
              )}
              {canGroup && (
                <button onClick={makeBlock}>
                  {t.editor.makeBlock} <kbd>{k("mod", "G")}</kbd>
                </button>
              )}
              {block && (
                <button onClick={dissolveBlock}>
                  {t.editor.dissolve} <kbd>{k("mod", "shift", "G")}</kbd>
                </button>
              )}
              {selected.length > 0 && doc && (
                <>
                  <hr />
                  {STACK_MOVES.map(({ move, keys: combo }) => (
                    <button key={move} onClick={() => commit(moveShapes(doc, selectedIds, move))}>
                      {t.layers.stack[move]} <kbd>{k(...combo)}</kbd>
                    </button>
                  ))}
                </>
              )}
            </ContextMenu>
          )}
          {tip && (
            <div className="tip" role="status">
              <span aria-hidden>💡</span>
              <p>{t.tips[tip]}</p>
              <button onClick={() => updateGuide({ ...guide, seenTips: [...guide.seenTips, tip] })}>
                {t.tips.gotIt}
              </button>
            </div>
          )}
        </main>
        {guide.showLayers && doc && (
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
