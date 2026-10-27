import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { countItems, listItems, type LibraryItem, type ListQuery } from "../api";

/** Items per request. Large enough for a screenful, small enough to be instant. */
export const PAGE_SIZE = 200;
/**
 * Requests in flight at once; more would only delay the page now on screen.
 * Visible pages always start right away, fetching ahead fills up to this.
 */
const MAX_IN_FLIGHT = 2;
/** Pages kept in memory; the ones farthest from the view are dropped first. */
const MAX_PAGES = 40;

export interface LibraryPages {
  /** Number of matching items, or null while loading. */
  count: number | null;
  /** The item at `index`, or undefined if its page is not loaded yet. */
  getItem(index: number): LibraryItem | undefined;
  /**
   * Loads the pages covering `start..=end` (call with the visible range),
   * then the ones within `ahead` items before and after it.
   */
  ensureRange(start: number, end: number, ahead?: number): void;
  /** Replaces an item in the cache after it changed (e.g. was renamed). */
  replaceItem(item: LibraryItem): void;
}

/**
 * The library list as a sparse array of pages, for virtualized views: only
 * the pages around what is on screen are ever fetched and kept, so neither
 * speed nor memory depend on whether the library has 100 or 100 000 items.
 * When the view jumps (e.g. dragging the scrollbar), pages it passed are not
 * fetched at all. Changing `query` or bumping `version` drops the cache.
 */
export function useLibraryPages(query: ListQuery, version: string | number): LibraryPages {
  const [count, setCount] = useState<number | null>(null);
  const pages = useRef(new Map<number, LibraryItem[]>());
  const loading = useRef(new Set<number>());
  /** Pages of the most recently requested range, in load order. */
  const wanted = useRef<number[]>([]);
  /** How many of `wanted` are on screen (the rest is fetched ahead). */
  const visibleCount = useRef(0);
  // Responses from before the last reset are ignored.
  const generation = useRef(0);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const key = JSON.stringify(query);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const current = ++generation.current;
    pages.current = new Map();
    loading.current = new Set();
    // Fetched together with the count instead of after it: a new query starts
    // at the top, a refresh of the same query where the view already is.
    if (key !== lastKey.current || !wanted.current.length) {
      wanted.current = [0];
      visibleCount.current = 1;
    }
    lastKey.current = key;
    countItems(query)
      .then((n) => current === generation.current && setCount(n))
      .catch(() => current === generation.current && setCount(0));
    pump();
    rerender();
    // `key` stands for `query`.
  }, [key, version]);

  /** Starts loads for visible pages, and for the others while there is room. */
  const pump = useCallback(() => {
    const current = generation.current;
    for (const [at, page] of wanted.current.entries()) {
      if (pages.current.has(page) || loading.current.has(page)) continue;
      if (at >= visibleCount.current && loading.current.size >= MAX_IN_FLIGHT) return;
      loading.current.add(page);
      listItems(query, page * PAGE_SIZE, PAGE_SIZE)
        .then((items) => {
          if (current !== generation.current) return;
          pages.current.set(page, items);
          evictFarPages(pages.current, wanted.current);
          rerender();
        })
        .catch(() => {})
        .finally(() => {
          if (current !== generation.current) return;
          loading.current.delete(page);
          pump();
        });
    }
  }, [key, version]);

  const ensureRange = useCallback(
    (start: number, end: number, ahead = 0) => {
      const pagesOf = (from: number, to: number) => {
        const first = Math.floor(Math.max(0, from) / PAGE_SIZE);
        const last = Math.floor(Math.max(0, to) / PAGE_SIZE);
        return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
      };
      const visible = pagesOf(start, end);
      // Replaces the previous wish list: ranges scrolled past are not loaded.
      // The visible pages come first, so fetching ahead never delays them.
      wanted.current = [
        ...visible,
        ...pagesOf(start - ahead, Math.min(end + ahead, (count ?? 0) - 1)).filter((p) => !visible.includes(p)),
      ];
      visibleCount.current = visible.length;
      pump();
    },
    [pump, count],
  );

  const getItem = useCallback((index: number) => pages.current.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE], []);

  const replaceItem = useCallback((item: LibraryItem) => {
    for (const [page, items] of pages.current) {
      const at = items.findIndex((i) => i.id === item.id);
      if (at >= 0) pages.current.set(page, items.map((i, n) => (n === at ? item : i)));
    }
    rerender();
  }, []);

  return { count, getItem, ensureRange, replaceItem };
}

/** Drops the cached pages farthest from the wanted range beyond MAX_PAGES. */
function evictFarPages(pages: Map<number, LibraryItem[]>, wanted: number[]) {
  if (pages.size <= MAX_PAGES || !wanted.length) return;
  const center = (Math.min(...wanted) + Math.max(...wanted)) / 2;
  const byDistance = [...pages.keys()].sort((a, b) => Math.abs(b - center) - Math.abs(a - center));
  for (const page of byDistance.slice(0, pages.size - MAX_PAGES)) pages.delete(page);
}
