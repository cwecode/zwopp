import { defineConfig } from "@playwright/test";

// Performance budgets of the web UI, see e2e/budgets.e2e.ts. The files are
// named *.e2e.ts so vitest (which picks up *.test.ts / *.spec.ts) skips them.
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  // Timing tests must not compete with each other for the CPU.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:1430",
    browserName: "chromium",
    viewport: { width: 1100, height: 720 },
    // `gc()` and exact (not bucketed) `performance.memory` for the heap budget.
    launchOptions: { args: ["--js-flags=--expose-gc", "--enable-precise-memory-info"] },
  },
  webServer: {
    // The production build, as the app ships it.
    command: "npx vite build && npx vite preview --port 1430 --strictPort",
    url: "http://localhost:1430",
    timeout: 120_000,
  },
});
