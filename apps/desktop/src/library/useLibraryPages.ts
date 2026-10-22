import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { countItems, listItems, type LibraryItem, type ListQuery } from "../api";

/** Items per request. Large enough for a screenful, small enough to be instant. */
export const PAGE_SIZE = 200;
/** Requests in flight at once; more would only delay the page now on screen. */
const MAX_IN_FLIGHT = 2;
/** Pages kept in memory; the ones farthest from the view are dropped first. */
const MAX_PAGES = 40;

export interface LibraryPages {
  /** Number of matching items, or null while loading. */
  count: number | null;
  /** The item at `index`, or undefined if its page is not loaded yet. */
  getItem(index: number): LibraryItem | undefined;
  /** Loads the pages covering `start..=end` (call with the visible range). */
  ensureRange(start: number, end: number): void;
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
  // Responses from before the last reset are ignored.
  const generation = useRef(0);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const key = JSON.stringify(query);

  useEffect(() => {
    const current = ++generation.current;
    pages.current = new Map();
    loading.current = new Set();
    wanted.current = [];
    countItems(query)
      .then((n) => current === generation.current && setCount(n))
      .catch(() => current === generation.current && setCount(0));
    rerender();
    // `key` stands for `query`.
  }, [key, version]);

  /** Starts loads for wanted pages until MAX_IN_FLIGHT requests are running. */
  const pump = useCallback(() => {
    const current = generation.current;
    while (loading.current.size < MAX_IN_FLIGHT) {
      const page = wanted.current.find((p) => !pages.current.has(p) && !loading.current.has(p));
      if (page === undefined) return;
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
    (start: number, end: number) => {
      const first = Math.floor(Math.max(0, start) / PAGE_SIZE);
      const last = Math.floor(Math.max(0, end) / PAGE_SIZE);
      // Replaces the previous wish list: ranges scrolled past are not loaded.
      wanted.current = Array.from({ length: last - first + 1 }, (_, i) => first + i);
      pump();
    },
    [pump],
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
  const center = (wanted[0] + wanted[wanted.length - 1]) / 2;
  const byDistance = [...pages.keys()].sort((a, b) => Math.abs(b - center) - Math.abs(a - center));
  for (const page of byDistance.slice(0, pages.size - MAX_PAGES)) pages.delete(page);
}
