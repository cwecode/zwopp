// Performance budgets of the library UI (docs/PLAN.md, Phase 1.5), checked in
// CI against the production build with a mocked backend of 100 000 items:
//
//   npm run test:budgets -w apps/desktop
//
// The core's part of these budgets (queries, paging, search) is checked by
// crates/core/tests/budgets.rs; here the backend answers after a fixed delay.
import { deflateSync, crc32 } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { tauriMock, type BudgetProbe } from "./tauri-mock";

const ITEMS = 100_000;
/** Per command; the core needs 2–20 ms for a page or a search (see budgets.rs). */
const LATENCY_MS = 10;
/** The search field waits this long after the last keystroke (Library.tsx). */
const SEARCH_DEBOUNCE_MS = 150;

const BUDGET = {
  /** Library open → first thumbnails visible. */
  firstThumbnailsMs: 200,
  /** Scrollbar jump → no empty cards. */
  emptyCardsMs: 100,
  /** Search typed → results, on top of the debounce. */
  searchMs: 50,
  /** While scrolling: no frame longer than this (60 fps is 16.7 ms). */
  longestFrameMs: 50,
  /** Elements in the page, however large the library. */
  domElements: 2_000,
  /** Heap growth after jumping through the whole library. */
  heapGrowthMb: 10,
};

declare global {
  interface Window {
    __budget: BudgetProbe;
    gc?: () => void;
  }
}

/** A 320×180 PNG with some detail, standing in for a real thumbnail. */
function thumbnailPng(): Buffer {
  const [width, height] = [320, 180];
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * (width * 4 + 1) + 1 + x * 4;
      const text = Math.floor(y / 9) % 3 === 0 && (Math.floor(x / 4) + y) % 5 < 2;
      raw.set(text ? [40, 40, 60, 255] : [245, 246, 250, 255], at);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = thumbnailPng();

async function openLibrary(page: Page) {
  await page.addInitScript(tauriMock, { items: ITEMS, latencyMs: LATENCY_MS });
  // Served like the `thumb://` protocol: immutable, cached by the webview.
  await page.route("http://thumb.localhost/**", (route) =>
    route.fulfill({
      body: png,
      contentType: "image/png",
      headers: { "cache-control": "public, max-age=31536000, immutable" },
    }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.__budget.firstThumbAt !== null);
}

/**
 * Moves the grid's scrollbar to `fraction` of its range and returns the ms
 * until no placeholder card is left. Runs entirely in the page, so the test
 * runner's round trips are not counted.
 */
const jump = (page: Page, fraction: number) =>
  page.evaluate(
    (fraction) =>
      new Promise<number>((resolve) => {
        const scroller = document.querySelector<HTMLElement>(".grid-scroller")!;
        const since = performance.now();
        scroller.scrollTop = fraction * (scroller.scrollHeight - scroller.clientHeight);
        const check = () =>
          document.querySelector(".card.placeholder") ? requestAnimationFrame(check) : resolve(performance.now() - since);
        // Give the scroll a frame to render the placeholders first.
        requestAnimationFrame(check);
      }),
    fraction,
  );

const report = (name: string, measured: number, budget: number, unit = "ms") =>
  console.log(`${name.padEnd(44)} ${String(budget).padStart(7)} ${unit}  ${measured.toFixed(1).padStart(8)} ${unit}`);

test.describe(`library with ${ITEMS.toLocaleString("en")} items`, () => {
  test("first thumbnails appear quickly", async ({ page }) => {
    // The first load also starts the browser and the server; not counted.
    await openLibrary(page);
    const times: number[] = [];
    for (let run = 0; run < 5; run++) {
      await page.reload();
      await page.waitForFunction(() => window.__budget.firstThumbAt !== null);
      times.push(await page.evaluate(() => window.__budget.firstThumbAt!));
    }
    const median = times.sort((a, b) => a - b)[2];
    report("open → first thumbnails (median of 5)", median, BUDGET.firstThumbnailsMs);
    expect(median).toBeLessThanOrEqual(BUDGET.firstThumbnailsMs);
  });

  test("scrolling stays smooth", async ({ page }) => {
    await openLibrary(page);
    // Scroll ~10 rows per second for 3 s, frame by frame, like a trackpad.
    const { frames, longTasks } = await page.evaluate(
      () =>
        new Promise<{ frames: number[]; longTasks: number[] }>((resolve) => {
          const scroller = document.querySelector<HTMLElement>(".grid-scroller")!;
          const tasksBefore = window.__budget.longTasks.length;
          const frames: number[] = [];
          let last = performance.now();
          const end = last + 3000;
          const step = (now: number) => {
            frames.push(now - last);
            last = now;
            scroller.scrollTop += 32;
            if (now < end) requestAnimationFrame(step);
            else resolve({ frames, longTasks: window.__budget.longTasks.slice(tasksBefore) });
          };
          requestAnimationFrame(step);
        }),
    );
    const longest = Math.max(...frames.slice(1));
    report("scrolling: longest frame", longest, BUDGET.longestFrameMs);
    expect(longTasks).toEqual([]);
    expect(longest).toBeLessThanOrEqual(BUDGET.longestFrameMs);
  });

  test("jumps with the scrollbar leave no empty cards", async ({ page }) => {
    await openLibrary(page);
    const times: number[] = [];
    for (const fraction of [0.5, 0.97, 0.1, 1, 0.33, 0.75]) {
      times.push(await jump(page, fraction));
    }
    const worst = Math.max(...times);
    report("jump → no empty cards (worst of 6)", worst, BUDGET.emptyCardsMs);
    expect(worst).toBeLessThanOrEqual(BUDGET.emptyCardsMs);
  });

  test("search results appear right after typing", async ({ page }) => {
    await openLibrary(page);
    const times: number[] = [];
    for (const search of ["chnung", "review", "login rechnung 42", ""]) {
      // Typed and timed inside the page, so the test runner's own round
      // trips do not count.
      const elapsed = await page.evaluate(
        (search) =>
          new Promise<number>((resolve) => {
            const label = `${window.__budget.countMatches(search).toLocaleString("de-DE")} Screenshots`;
            const input = document.querySelector<HTMLInputElement>(".search")!;
            const since = performance.now();
            // React listens for `input` and reads the value through the native setter.
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, search);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            const check = () => {
              const counted = [...document.querySelectorAll(".toolbar .meta")].some((e) => e.textContent === label);
              if (counted && !document.querySelector(".card.placeholder")) resolve(performance.now() - since);
              else requestAnimationFrame(check);
            };
            check();
          }),
        search,
      );
      report(`  search "${search}"`, elapsed - SEARCH_DEBOUNCE_MS, BUDGET.searchMs);
      times.push(elapsed - SEARCH_DEBOUNCE_MS);
    }
    const worst = Math.max(...times);
    report(`search → results (after ${SEARCH_DEBOUNCE_MS} ms debounce)`, worst, BUDGET.searchMs);
    expect(worst).toBeLessThanOrEqual(BUDGET.searchMs);
  });

  test("memory does not grow with the library", async ({ page }) => {
    await openLibrary(page);
    const heap = () =>
      page.evaluate(() => {
        window.gc?.();
        return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
      });
    const before = await heap();
    for (let n = 0; n <= 40; n++) await jump(page, n / 40);
    const growthMb = ((await heap()) - before) / 1024 / 1024;
    const elements = await page.evaluate(() => document.querySelectorAll("*").length);
    report("DOM elements after 40 jumps", elements, BUDGET.domElements, "el");
    report("heap growth after 40 jumps", growthMb, BUDGET.heapGrowthMb, "MB");
    expect(elements).toBeLessThanOrEqual(BUDGET.domElements);
    expect(growthMb).toBeLessThanOrEqual(BUDGET.heapGrowthMb);
  });
});
