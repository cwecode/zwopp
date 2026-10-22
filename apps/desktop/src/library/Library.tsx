import { useCallback, useEffect, useState } from "react";
import {
  captureShortcut,
  copyItem,
  deleteItem,
  fileUrl,
  formatShortcut,
  listItems,
  startCapture,
  updateItem,
  type ItemUpdate,
  type LibraryItem,
} from "../api";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

const parseTags = (text: string) =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

export function Library({ onOpen }: { onOpen(item: LibraryItem): void }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [shortcut, setShortcut] = useState<string | null>(null);

  const report = (e: unknown) => setMessage(String(e));

  useEffect(() => {
    captureShortcut()
      .then((s) => setShortcut(s && formatShortcut(s)))
      .catch(report);
  }, []);

  const refresh = useCallback(() => {
    listItems({ search, favoritesOnly }).then(setItems).catch(report);
  }, [search, favoritesOnly]);

  useEffect(() => {
    const timer = window.setTimeout(refresh, 150);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const selected = items.find((item) => item.id === selectedId);

  const update = async (id: string, change: ItemUpdate) => {
    try {
      const updated = await updateItem(id, change);
      setItems((list) => list.map((i) => (i.id === id ? updated : i)));
    } catch (e) {
      report(e);
    }
  };

  const remove = async (id: string) => {
    await deleteItem(id).catch(report);
    if (id === selectedId) setSelectedId(undefined);
    refresh();
  };

  const copy = async (id: string) => {
    await copyItem(id)
      .then(() => setMessage("In die Zwischenablage kopiert"))
      .catch(report);
  };

  return (
    <div className="library">
      <header className="toolbar">
        <h1>Screenbook</h1>
        <input
          type="search"
          className="search"
          placeholder="Suchen (Titel, Tags) …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={favoritesOnly ? "tool active" : "tool"}
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((f) => !f)}
          title="Nur Favoriten"
        >
          ★ Favoriten
        </button>
        <span className="spacer" />
        <button className="primary" onClick={() => startCapture().catch(report)}>
          Neuer Screenshot
        </button>
        {shortcut && <kbd>{shortcut}</kbd>}
      </header>

      {message && (
        <div className="notice" role="status">
          {message}
          <button onClick={() => setMessage(undefined)}>OK</button>
        </div>
      )}

      <main className="content">
        {items.length === 0 ? (
          <div className="empty">
            {search || favoritesOnly ? (
              <p>Keine Treffer.</p>
            ) : (
              <>
                <p>Noch keine Screenshots.</p>
                <p>
                  {shortcut ? (
                    <>
                      Drücke <kbd>{shortcut}</kbd> oder klicke auf „Neuer Screenshot“.
                    </>
                  ) : (
                    <>Klicke auf „Neuer Screenshot“ oder nutze das Tray-Menü.</>
                  )}
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className="grid">
            {items.map((item) => (
              <li key={item.id}>
                <div
                  className={item.id === selectedId ? "card selected" : "card"}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(item.id)}
                  onDoubleClick={() => onOpen(item)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(item)}
                >
                  <img src={fileUrl(item.thumbPath, item.updatedAt)} alt="" loading="lazy" />
                  <button
                    className={item.favorite ? "star active" : "star"}
                    title={item.favorite ? "Favorit entfernen" : "Als Favorit markieren"}
                    aria-pressed={item.favorite}
                    onClick={(e) => {
                      e.stopPropagation();
                      void update(item.id, { favorite: !item.favorite });
                    }}
                  >
                    ★
                  </button>
                  <span className="card-title">{item.title || "Ohne Titel"}</span>
                  <span className="meta">
                    {dateFormat.format(new Date(item.createdAt))} · {item.width} × {item.height}
                  </span>
                  {item.tags.length > 0 && (
                    <span className="tags">
                      {item.tags.map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <aside className="preview" key={selected.id}>
            <img
              src={fileUrl(selected.renderPath ?? selected.originalPath, selected.updatedAt)}
              alt="Ausgewählter Screenshot"
              onDoubleClick={() => onOpen(selected)}
            />
            <label>
              Titel
              <input
                defaultValue={selected.title}
                placeholder="Ohne Titel"
                onBlur={(e) =>
                  e.target.value !== selected.title && update(selected.id, { title: e.target.value })
                }
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
            <label>
              Tags (durch Komma getrennt)
              <input
                defaultValue={selected.tags.join(", ")}
                placeholder="z. B. bug, login"
                onBlur={(e) => {
                  const tags = parseTags(e.target.value);
                  if (tags.join("\n") !== selected.tags.join("\n")) void update(selected.id, { tags });
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
            <div className="preview-actions">
              <button className="primary" onClick={() => onOpen(selected)}>
                Bearbeiten
              </button>
              <button onClick={() => copy(selected.id)}>Kopieren</button>
              <span className="spacer" />
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
