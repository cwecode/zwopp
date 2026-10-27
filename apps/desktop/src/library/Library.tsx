import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  captureShortcut,
  copyItem,
  deleteItem,
  fileUrl,
  startCapture,
  thumbUrl,
  updateItem,
  type ItemUpdate,
  type LibraryItem,
  type ListQuery,
} from "../api";
import { formatAccelerator, useT } from "../i18n";
import { useLibraryPages } from "./useLibraryPages";

/** Grid geometry; rows have a fixed height so the list can be virtualized. */
const CARD_MIN_WIDTH = 190;
const GAP = 12;
const PADDING = 16;
const ROW_HEIGHT = 196;
/** Rows above and below the view whose data is fetched ahead of scrolling. */
const PREFETCH_ROWS = 6;

const parseTags = (text: string) =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

export function Library({ onOpen }: { onOpen(item: LibraryItem): void }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // Starts as what the debounce below produces, so opening loads only once.
  const [query, setQuery] = useState<ListQuery>({ search: undefined, favoritesOnly });
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<LibraryItem>();
  const [message, setMessage] = useState<string>();
  const [accelerator, setAccelerator] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  const report = (e: unknown) => setMessage(String(e));
  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    captureShortcut()
      .then(setAccelerator)
      .catch(report);
  }, []);

  // Debounce typing; the query object only changes when the search settles.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery({ search: search.trim() || undefined, favoritesOnly }), 150);
    return () => window.clearTimeout(timer);
  }, [search, favoritesOnly]);

  // The background index sync and thumbnail generation can change the list.
  useEffect(() => {
    const unlisten = Promise.all([listen("library:indexed", refresh), listen("library:thumbnails", refresh)]);
    return () => void unlisten.then((fns) => fns.forEach((fn) => fn()));
  }, []);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shortcut = accelerator && formatAccelerator(t, accelerator);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(t.locale, { dateStyle: "medium", timeStyle: "short" }),
    [t.locale],
  );

  const pages = useLibraryPages(query, version);
  const count = pages.count ?? 0;
  const columns = Math.max(1, Math.floor((width - PADDING * 2 + GAP) / (CARD_MIN_WIDTH + GAP)));
  const rows = Math.ceil(count / columns);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    // Every rendered row costs layout and paint on a jump; rows further out
    // are only fetched ahead (PREFETCH_ROWS), not rendered.
    overscan: 1,
    paddingStart: PADDING,
    paddingEnd: PADDING,
  });
  const virtualRows = virtualizer.getVirtualItems();

  // Fetch the pages behind the rows on screen, then the ones just beyond.
  const first = virtualRows[0]?.index ?? 0;
  const last = virtualRows[virtualRows.length - 1]?.index ?? 0;
  useEffect(() => {
    if (count) pages.ensureRange(first * columns, (last + 1) * columns - 1, PREFETCH_ROWS * columns);
  }, [first, last, columns, count, pages]);

  const update = async (id: string, change: ItemUpdate) => {
    try {
      const updated = await updateItem(id, change);
      if (selected?.id === id) setSelected(updated);
      // Leaving the favorites filter changes the list itself.
      if (favoritesOnly && change.favorite === false) refresh();
      else pages.replaceItem(updated);
    } catch (e) {
      report(e);
    }
  };

  const remove = async (id: string) => {
    await deleteItem(id).catch(report);
    if (id === selected?.id) setSelected(undefined);
    refresh();
  };

  const copy = async (id: string) => {
    await copyItem(id)
      .then(() => setMessage(t.library.copied))
      .catch(report);
  };

  const gridStyle = useMemo(
    () => ({ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP }),
    [columns],
  );

  const card = (item: LibraryItem) => (
    <div
      key={item.id}
      className={item.id === selected?.id ? "card selected" : "card"}
      role="button"
      tabIndex={0}
      onClick={() => setSelected(item)}
      onDoubleClick={() => onOpen(item)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(item)}
    >
      {/* Not `loading="lazy"`: only rows near the view exist, and lazy
          loading would wait for layout before requesting the image. */}
      <img src={thumbUrl(item)} alt="" decoding="async" />
      <button
        className={item.favorite ? "star active" : "star"}
        title={item.favorite ? t.library.unfavorite : t.library.favorite}
        aria-pressed={item.favorite}
        onClick={(e) => {
          e.stopPropagation();
          void update(item.id, { favorite: !item.favorite });
        }}
      >
        ★
      </button>
      <span className="card-title">{item.title || t.untitled}</span>
      <span className="meta">
        {dateFormat.format(new Date(item.createdAt))} · {item.width} × {item.height}
      </span>
      <span className="tags">
        {item.tags.map((tag) => (
          <span key={tag} className="tag">
            {tag}
          </span>
        ))}
      </span>
    </div>
  );

  return (
    <div className="library">
      <header className="toolbar">
        <h1>Screenbook</h1>
        <input
          type="search"
          className="search"
          placeholder={t.library.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={favoritesOnly ? "tool active" : "tool"}
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((f) => !f)}
          title={t.library.favoritesOnly}
        >
          ★ {t.library.favorites}
        </button>
        {pages.count !== null && <span className="meta">{t.library.count(count)}</span>}
        <span className="spacer" />
        <button className="primary" onClick={() => startCapture().catch(report)}>
          {t.library.newScreenshot}
        </button>
        {shortcut && <kbd>{shortcut}</kbd>}
      </header>

      {message && (
        <div className="notice" role="status">
          {message}
          <button onClick={() => setMessage(undefined)}>{t.ok}</button>
        </div>
      )}

      <main className="content">
        <div className="grid-scroller" ref={scroller}>
          {pages.count === 0 && (
            <div className="empty">
              {query.search || query.favoritesOnly ? (
                <p>{t.library.noMatches}</p>
              ) : (
                <>
                  <p>{t.library.empty}</p>
                  <p>
                    {shortcut ? t.library.emptyHint(<kbd>{shortcut}</kbd>) : t.library.emptyHintNoShortcut}
                  </p>
                </>
              )}
            </div>
          )}
          {/* Only the rows on screen exist in the DOM. */}
          <div className="grid-space" style={{ height: virtualizer.getTotalSize() }}>
            {virtualRows.map((row) => (
              <div
                key={row.key}
                className="grid-row"
                style={{ ...gridStyle, transform: `translateY(${row.start}px)`, height: ROW_HEIGHT - GAP }}
              >
                {Array.from({ length: columns }, (_, column) => {
                  const index = row.index * columns + column;
                  if (index >= count) return null;
                  const item = pages.getItem(index);
                  return item ? card(item) : <div key={`placeholder-${index}`} className="card placeholder" />;
                })}
              </div>
            ))}
          </div>
        </div>

        {selected && (
          <aside className="preview" key={selected.id}>
            <img
              src={fileUrl(selected.renderPath ?? selected.originalPath, selected.updatedAt)}
              alt={t.library.selected}
              onDoubleClick={() => onOpen(selected)}
            />
            <label>
              {t.library.title}
              <input
                defaultValue={selected.title}
                placeholder={t.untitled}
                onBlur={(e) =>
                  e.target.value !== selected.title && update(selected.id, { title: e.target.value })
                }
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
            <label>
              {t.library.tags}
              <input
                defaultValue={selected.tags.join(", ")}
                placeholder={t.library.tagsExample}
                onBlur={(e) => {
                  const tags = parseTags(e.target.value);
                  if (tags.join("\n") !== selected.tags.join("\n")) void update(selected.id, { tags });
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
            <div className="preview-actions">
              <button className="primary" onClick={() => onOpen(selected)}>
                {t.library.edit}
              </button>
              <button onClick={() => copy(selected.id)}>{t.library.copy}</button>
              <span className="spacer" />
              <button className="danger" onClick={() => remove(selected.id)}>
                {t.library.delete}
              </button>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}
