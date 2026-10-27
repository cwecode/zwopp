import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { itemPosition, listItems, thumbUrl, type LibraryItem, type ListQuery } from "../api";
import { keys, useT } from "../i18n";
import { useLibraryPages } from "../library/useLibraryPages";

export interface FilmstripHandle {
  /** Opens the newer (-1) or older (+1) neighbour of the current item. */
  step(direction: 1 | -1): void;
}

interface Props {
  currentId: string;
  /** Changes when the library changed (e.g. the current item was saved). */
  version: string;
  onOpen(item: LibraryItem): void;
}

const ALL: ListQuery = {};
const ITEM_WIDTH = 132;

/**
 * The library along the bottom of the editor, newest first. Virtualized like
 * the library grid, so it stays fast with any number of screenshots.
 */
export const Filmstrip = forwardRef<FilmstripHandle, Props>(function Filmstrip(
  { currentId, version, onOpen },
  ref,
) {
  const t = useT();
  const pages = useLibraryPages(ALL, version);
  const count = pages.count ?? 0;
  const [position, setPosition] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    itemPosition(currentId).then(setPosition).catch(() => setPosition(null));
  }, [currentId, version]);

  const virtualizer = useVirtualizer({
    horizontal: true,
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => ITEM_WIDTH,
    overscan: 8,
  });
  const visible = virtualizer.getVirtualItems();
  const first = visible[0]?.index ?? 0;
  const last = visible[visible.length - 1]?.index ?? 0;

  useEffect(() => {
    if (count) pages.ensureRange(first, last);
  }, [first, last, count, pages]);

  // Keep the current item in view when switching items.
  useEffect(() => {
    if (position !== null && count) virtualizer.scrollToIndex(position, { align: "center" });
  }, [position, count, virtualizer]);

  const step = async (direction: 1 | -1) => {
    if (position === null) return;
    const index = position + direction;
    if (index < 0 || index >= count) return;
    const item = pages.getItem(index) ?? (await listItems(ALL, index, 1))[0];
    if (item) onOpen(item);
  };

  useImperativeHandle(ref, () => ({ step: (direction) => void step(direction) }));

  return (
    <nav className="filmstrip" aria-label="Bibliothek">
      <button
        className="filmstrip-step"
        disabled={position === null || position <= 0}
        onClick={() => step(-1)}
        title={`${t.editor.newer} (${keys(t, ["alt", "←"])})`}
      >
        ‹
      </button>
      <div className="filmstrip-scroller" ref={scroller}>
        <div className="filmstrip-space" style={{ width: virtualizer.getTotalSize() }}>
          {visible.map((cell) => {
            const item = pages.getItem(cell.index);
            const isCurrent = item?.id === currentId;
            return (
              <div
                key={cell.key}
                className="filmstrip-cell"
                style={{ transform: `translateX(${cell.start}px)`, width: ITEM_WIDTH }}
              >
                {item ? (
                  <button
                    className={isCurrent ? "filmstrip-item current" : "filmstrip-item"}
                    aria-current={isCurrent}
                    title={item.title || new Date(item.createdAt).toLocaleString(t.locale)}
                    onClick={() => onOpen(item)}
                  >
                    <img src={thumbUrl(item)} alt="" decoding="async" />
                  </button>
                ) : (
                  <div className="filmstrip-item placeholder" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <button
        className="filmstrip-step"
        disabled={position === null || position >= count - 1}
        onClick={() => step(1)}
        title={`${t.editor.older} (${keys(t, ["alt", "→"])})`}
      >
        ›
      </button>
    </nav>
  );
});
