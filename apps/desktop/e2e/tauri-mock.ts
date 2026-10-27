// A stand-in for the Tauri backend, so the built web UI can be measured in a
// plain browser with a library of any size. Installed with
// `page.addInitScript(tauriMock, options)`; the function runs in the page and
// must not reference anything outside its body.

export interface MockOptions {
  /** Number of items in the synthetic library. */
  items: number;
  /** Delay of every command, roughly IPC plus the core's query time. */
  latencyMs: number;
}

/** Measurements the page collects for the tests (see budgets.e2e.ts). */
export interface BudgetProbe {
  /** `performance.now()` when the first grid thumbnail finished loading. */
  firstThumbAt: number | null;
  /** Durations of main-thread tasks longer than 50 ms. */
  longTasks: number[];
  /** Number of items matching a search, as the mock computes it. */
  countMatches(search: string): number;
}

export function tauriMock({ items, latencyMs }: MockOptions) {
  const WORDS = ["Rechnung", "Login", "Dialog", "Fehler", "Bestellung", "Kunde", "Dashboard", "Export"];
  const TAGS = ["bug", "ui", "doku", "kunde", "intern", "review", "design", "support"];
  const newest = Date.UTC(2026, 9, 1);

  // Item `i` is at position `i` of the unfiltered list (newest first).
  const item = (i: number) => {
    const time = new Date(newest - i * 60_000).toISOString();
    return {
      id: `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`,
      createdAt: time,
      updatedAt: time,
      width: 1920,
      height: 1080,
      title: `${WORDS[i % WORDS.length]} ${WORDS[Math.floor(i / 7) % WORDS.length]} ${i}`,
      favorite: i % 50 === 0,
      tags: [TAGS[i % TAGS.length], TAGS[Math.floor(i / 3) % TAGS.length]],
      hasAnnotations: false,
      originalPath: `/library/items/${i}/original.png`,
      renderPath: null,
    };
  };
  // Built on the first search, so opening the library does not pay for it.
  let texts: string[] | undefined;
  const searchable = () =>
    (texts ??= Array.from({ length: items }, (_, i) => {
      const it = item(i);
      return `${it.title} ${it.tags.join(" ")}`.toLowerCase();
    }));

  // Positions matching a query, cached per query like a warm database.
  const matches = new Map<string, number[] | null>();
  const filter = (query: { search?: string; favoritesOnly?: boolean } = {}) => {
    const key = JSON.stringify([query.search?.trim() ?? "", !!query.favoritesOnly]);
    if (!matches.has(key)) {
      const words = (query.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      matches.set(
        key,
        words.length || query.favoritesOnly
          ? searchable().flatMap((text, i) =>
              words.every((w) => text.includes(w)) && (!query.favoritesOnly || i % 50 === 0) ? [i] : [],
            )
          : null,
      );
    }
    return matches.get(key) ?? null;
  };
  const at = (positions: number[] | null, index: number) => (positions ? positions[index] : index);
  const total = (positions: number[] | null) => (positions ? positions.length : items);

  type Args = Record<string, any>;
  const commands: Record<string, (args: Args) => unknown> = {
    capture_shortcut: () => "CommandOrControl+Shift+X",
    list_tags: () => TAGS,
    count_items: ({ query }) => total(filter(query)),
    list_items: ({ query, offset, limit }) => {
      const positions = filter(query);
      const end = Math.min(total(positions), offset + limit);
      return Array.from({ length: Math.max(0, end - offset) }, (_, n) => item(at(positions, offset + n)));
    },
    item_position: ({ id, query }) => {
      const index = Number(id.slice(-12));
      const positions = filter(query);
      const position = positions ? positions.indexOf(index) : index;
      return position < 0 ? null : position;
    },
    "plugin:event|listen": () => Math.floor(Math.random() * 1e9),
    "plugin:event|unlisten": () => null,
  };

  let callbacks = 0;
  (window as any).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: (callback: (value: unknown) => void) => {
      const id = ++callbacks;
      (window as any)[`_${id}`] = callback;
      return id;
    },
    unregisterCallback: (id: number) => delete (window as any)[`_${id}`],
    convertFileSrc: (path: string, protocol = "asset") => `http://${protocol}.localhost/${encodeURIComponent(path)}`,
    invoke: (cmd: string, args: Args = {}) =>
      new Promise((resolve, reject) =>
        setTimeout(() => {
          const command = commands[cmd];
          if (command) resolve(command(args));
          else reject(`not mocked: ${cmd}`);
        }, latencyMs),
      ),
  };
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

  const probe: BudgetProbe = {
    firstThumbAt: null,
    longTasks: [],
    countMatches: (search) => total(filter({ search })),
  };
  (window as any).__budget = probe;
  // `load` does not bubble, but it can be caught on the way down.
  document.addEventListener(
    "load",
    (event) => {
      const target = event.target as HTMLElement;
      if (probe.firstThumbAt === null && target.tagName === "IMG" && target.closest(".card")) {
        probe.firstThumbAt = performance.now();
      }
    },
    true,
  );
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) probe.longTasks.push(entry.duration);
  }).observe({ type: "longtask", buffered: true });
}
