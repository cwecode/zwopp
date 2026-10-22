import { useCallback, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CAPTURE_SHORTCUT_LABEL,
  deleteItem,
  listItems,
  startCapture,
  type LibraryItem,
} from "../api";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

export function Library() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(() => {
    listItems().then(setItems).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen<LibraryItem>("library:changed", (event) => {
      refresh();
      setSelectedId(event.payload.id);
    });
    return () => void unlisten.then((fn) => fn());
  }, [refresh]);

  const selected = items.find((item) => item.id === selectedId);

  const remove = async (id: string) => {
    await deleteItem(id).catch((e) => setError(String(e)));
    if (id === selectedId) setSelectedId(undefined);
    refresh();
  };

  return (
    <div className="library">
      <header className="toolbar">
        <h1>Screenbook</h1>
        <button className="primary" onClick={() => startCapture().catch((e) => setError(String(e)))}>
          Neuer Screenshot
        </button>
        <kbd>{CAPTURE_SHORTCUT_LABEL}</kbd>
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError(undefined)}>Schließen</button>
        </div>
      )}

      <main className="content">
        {items.length === 0 ? (
          <div className="empty">
            <p>Noch keine Screenshots.</p>
            <p>
              Drücke <kbd>{CAPTURE_SHORTCUT_LABEL}</kbd> oder klicke auf „Neuer Screenshot“.
            </p>
          </div>
        ) : (
          <ul className="grid">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  className={item.id === selectedId ? "card selected" : "card"}
                  onClick={() => setSelectedId(item.id)}
                >
                  <img src={convertFileSrc(item.originalPath)} alt="" loading="lazy" />
                  <span className="meta">
                    {dateFormat.format(new Date(item.createdAt))} · {item.width} × {item.height}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <aside className="preview">
            <img src={convertFileSrc(selected.originalPath)} alt="Ausgewählter Screenshot" />
            <div className="preview-actions">
              <span className="meta">Der Editor folgt in Phase 1.</span>
              <button className="danger" onClick={() => remove(selected.id)}>
                Löschen
              </button>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}
