// Renders social-preview.html to social-preview.png (1280 × 640).
// Needs Playwright's Chromium once (npx playwright install chromium), or an
// installed browser: BROWSER_CHANNEL=msedge (or chrome) node render-social-preview.mjs
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.goto(pathToFileURL(path.join(dir, "social-preview.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(dir, "social-preview.png") });
await browser.close();
