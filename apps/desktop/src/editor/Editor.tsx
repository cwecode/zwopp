import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as api from "../api";
import type { LibraryItem } from "../api";
import { EditorCanvas, type CanvasHandle } from "./EditorCanvas";
import {
  eraseArea,
  loadDocument,
  removeShape,
  updateShape,
  type EditorDocument,
  type Rect,
} from "./document";
import { initHistory, push, redo, undo, type History } from "./history";
import { COLORS, HIGHLIGHT_COLOR, SIZES, TOOLS, stylePatch, type Tool, type ToolStyle } from "./tools";

export interface EditorHandle {
  /** Saves pending changes; call before leaving the editor. */
  flush(): Promise<void>;
}

interface Props {
  item: LibraryItem;
  onClose(): void;
  onSaved(item: LibraryItem): void;
}

type SaveStatus = "saved" | "pending" | "saving" | "error";

const AUTOSAVE_DELAY = 700;

const DEFAULT_STYLES: Record<Tool, ToolStyle> = {
  select: { color: COLORS[0], size: 1 },
  arrow: { color: COLORS[0], size: 1 },
  rect: { color: COLORS[0], size: 1 },
  text: { color: COLORS[0], size: 1 },
  highlight: { color: HIGHLIGHT_COLOR, size: 1 },
  blur: { color: COLORS[0], size: 1 },
};

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Gespeichert",
  pending: "Ungespeichert",
  saving: "Speichert …",
  error: "Speichern fehlgeschlagen",
};

function isTyping(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  return target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ item, onClose, onSaved }, ref) {
  const [image, setImage] = useState<HTMLImageElement>();
  const [history, setHistory] = useState<History<EditorDocument>>();
  const [live, setLive] = useState<EditorDocument | null>(null);
  const [tool, setTool] = useState<Tool>("arrow");
  const [styles, setStyles] = useState(DEFAULT_STYLES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [message, setMessage] = useState<string>();
  const [area, setArea] = useState({ width: 0, height: 0 });

  const canvas = useRef<CanvasHandle>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  // Async code reads the latest state through refs.
  const historyRef = useRef(history);
  const liveRef = useRef(live);
  historyRef.current = history;
  liveRef.current = live;
  const savedDoc = useRef<EditorDocument>(undefined);
  const saving = useRef<Promise<void>>(undefined);
  const timer = useRef<number>(undefined);

  // Load the original image and the stored annotations.
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    Promise.all([api.readOriginal(item.id), api.loadDocument(item.id)])
      .then(([bytes, stored]) => {
        url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          const doc = loadDocument(stored, img.naturalWidth, img.naturalHeight);
          savedDoc.current = doc;
          setHistory(initHistory(doc));
          setImage(img);
        };
        img.src = url;
      })
      .catch((e) => setMessage(String(e)));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
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
  const selected = doc?.objects.find((s) => s.id === selectedId) ?? null;
  const styleKey: Tool = selected?.type ?? tool;
  const style = styles[styleKey];

  const changeStyle = (patch: Partial<ToolStyle>) => {
    setStyles((s) => ({ ...s, [styleKey]: { ...s[styleKey], ...patch } }));
    if (selected && doc) commit(updateShape(doc, selected.id, stylePatch(selected, patch)));
  };

  const chooseTool = (next: Tool) => {
    setTool(next);
    setMarquee(null);
    if (next !== "select") setSelectedId(null);
  };

  /** Deletes the marked area, or else the selected shape. */
  const deleteSelected = () => {
    if (!doc) return;
    if (marquee) {
      commit(eraseArea(doc, marquee));
      setMarquee(null);
    } else if (selected) {
      commit(removeShape(doc, selected.id));
      setSelectedId(null);
    }
  };

  const close = async () => {
    await flush();
    onClose();
  };

  const copy = async () => {
    try {
      await flush();
      await api.copyItem(item.id);
      setMessage("In die Zwischenablage kopiert");
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

  // Keyboard shortcuts. Re-bound every render so handlers see current state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z" && !e.shiftKey) doUndo();
      else if (mod && (key === "y" || (key === "z" && e.shiftKey))) doRedo();
      else if (mod && key === "c") void copy();
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (e.key === "Escape") {
        setSelectedId(null);
        setMarquee(null);
        setTool("select");
      } else if (!mod && !e.altKey) {
        const match = TOOLS.find((t) => t.key === key);
        if (match) chooseTool(match.id);
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const showColor = styleKey !== "blur" && styleKey !== "select";
  const showSize = styleKey !== "highlight" && styleKey !== "select";

  return (
    <div className="editor">
      <header className="toolbar editor-toolbar">
        <button onClick={close} title="Zurück zur Bibliothek">
          ← Bibliothek
        </button>

        <div className="tool-group" role="toolbar" aria-label="Werkzeuge">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={tool === t.id ? "tool active" : "tool"}
              title={`${t.label} (${t.key.toUpperCase()})`}
              aria-pressed={tool === t.id}
              onClick={() => chooseTool(t.id)}
            >
              <span aria-hidden>{t.icon}</span>
              <span className="tool-label">{t.label}</span>
            </button>
          ))}
        </div>

        {showColor && (
          <div className="tool-group" aria-label="Farbe">
            {COLORS.map((color) => (
              <button
                key={color}
                className={style.color === color ? "swatch active" : "swatch"}
                style={{ background: color }}
                title={color}
                aria-label={`Farbe ${color}`}
                onClick={() => changeStyle({ color })}
              />
            ))}
          </div>
        )}

        {showSize && (
          <div className="tool-group" aria-label="Größe">
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

        <div className="tool-group">
          <button onClick={doUndo} disabled={!history?.past.length} title="Rückgängig (Strg+Z)">
            ↶
          </button>
          <button onClick={doRedo} disabled={!history?.future.length} title="Wiederholen (Strg+Y)">
            ↷
          </button>
          <button
            className={marquee ? "danger" : undefined}
            onClick={deleteSelected}
            disabled={!selected && !marquee}
            title="Löschen (Entf)"
          >
            {marquee ? "Bereich löschen" : "Löschen"}
          </button>
        </div>

        <span className={`save-status ${status}`}>{STATUS_LABEL[status]}</span>
        <button className="primary" onClick={copy} title="Kopieren (Strg+C)">
          Kopieren
        </button>
      </header>

      {message && (
        <div className="notice" role="status">
          {message}
          <button onClick={() => setMessage(undefined)}>OK</button>
        </div>
      )}

      <main className="editor-area" ref={areaRef}>
        {image && doc && present && area.width > 0 && (
          <EditorCanvas
            ref={canvas}
            image={image}
            doc={doc}
            layoutDoc={present}
            tool={tool}
            styles={styles}
            selectedId={selectedId}
            marquee={marquee}
            onMarquee={setMarquee}
            width={area.width}
            height={area.height}
            onSelect={setSelectedId}
            onPreview={setLive}
            onCommit={commit}
            onCancelPreview={() => setLive(null)}
          />
        )}
      </main>
    </div>
  );
});
