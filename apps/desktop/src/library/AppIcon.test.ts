import { describe, expect, it } from "vitest";
import { appHue } from "./AppIcon";

describe("appHue", () => {
  it("is stable per name and spreads names over the colour wheel", () => {
    expect(appHue("Excel")).toBe(appHue("Excel"));
    const hues = new Set(["Excel", "Firefox", "Outlook", "Teams", "Word"].map(appHue));
    expect(hues.size).toBe(5);
    for (const hue of hues) expect(hue).toBeGreaterThanOrEqual(0);
    for (const hue of hues) expect(hue).toBeLessThan(360);
  });
});
