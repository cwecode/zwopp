// Renders the brand images from their HTML sources next to this file:
// social-preview.png (1280 × 640) and banner-light.png / banner-dark.png (1600 × 500).
// Needs Playwright's Chromium once (npx playwright install chromium), or an
// installed browser: BROWSER_CHANNEL=msedge (or chrome) node render-social-preview.mjs
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const images = [
  { html: "social-preview.html", out: "social-preview.png", width: 1280, height: 640 },
  { html: "banner.html", out: "banner-light.png", width: 1600, height: 500 },
  { html: "banner.html?theme=dark", out: "banner-dark.png", width: 1600, height: 500 },
];

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
for (const { html, out, width, height } of images) {
  const page = await browser.newPage({ viewport: { width, height } });
  const [file, query = ""] = html.split("?");
  const url = pathToFileURL(path.join(dir, file)).href + (query && `?${query}`);
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(dir, out) });
  await page.close();
}
await browser.close();
