import { describe, expect, it } from "vitest";
import {
  initialStyles,
  parseQuickStyles,
  quickStylesFor,
  readEditorSettings,
  sameStyle,
  sanitizeStyle,
  styleFor,
  serializeQuickStyles,
  type QuickStyle,
} from "./quickStyles";
import { DEFAULT_STYLES } from "./tools";

const blueArrow: QuickStyle = {
  id: "q1",
  name: "Blauer Doppelpfeil",
  tool: "arrow",
  style: { color: "#2f80ed", size: 2, heads: { start: "filled", end: "filled" } },
};

describe("quick styles", () => {
  it("travel through a shared file with new ids", () => {
    const [copy] = parseQuickStyles(serializeQuickStyles([blueArrow]));
    expect(copy).toMatchObject({ name: blueArrow.name, tool: "arrow", style: blueArrow.style });
    expect(copy.id).not.toBe(blueArrow.id);
  });

  it("refuse files of another kind", () => {
    expect(() => parseQuickStyles("{}")).toThrow();
    expect(() => parseQuickStyles("not json")).toThrow();
  });

  it("drop entries for unknown tools and repair broken fields", () => {
    const file = JSON.stringify({
      format: "screenbook-quick-styles",
      version: 1,
      styles: [
        { name: "?", tool: "laser", style: {} },
        { name: "Rahmen", tool: "rect", style: { color: "red", size: 99, filled: "yes", font: "mono" } },
      ],
    });
    const styles = parseQuickStyles(file);
    expect(styles).toHaveLength(1);
    expect(styles[0].style).toEqual(DEFAULT_STYLES.rect);
  });

  it("keep only the fields their tool uses", () => {
    expect(sanitizeStyle("blur", { size: 3, heads: { start: "open", end: "open" }, emoji: "🔥" })).toEqual({
      ...DEFAULT_STYLES.blur,
      size: 3,
    });
    expect(sanitizeStyle("emoji", { emoji: "🔥", color: "#FFFFFF" })).toMatchObject({ emoji: "🔥", color: "#ffffff" });
  });

  it("compare only the fields their tool uses", () => {
    const current = { ...DEFAULT_STYLES.arrow, ...blueArrow.style, font: "mono" as const, filled: true };
    expect(sameStyle("arrow", current, blueArrow.style)).toBe(true);
    expect(sameStyle("arrow", { ...current, size: 1 }, blueArrow.style)).toBe(false);
    expect(Object.keys(styleFor("arrow", current)).sort()).toEqual(["color", "heads", "size"]);
  });

  it("are listed per tool", () => {
    const red = { ...blueArrow, id: "q2", tool: "rect" as const, style: DEFAULT_STYLES.rect };
    expect(quickStylesFor([blueArrow, red], "rect")).toEqual([red]);
  });
});

describe("editor settings", () => {
  it("start each tool with its last-used style", () => {
    const saved = readEditorSettings({ toolStyles: { arrow: { color: "#27ae60", size: 3 }, nope: {} } });
    const styles = initialStyles(saved.toolStyles);
    expect(styles.arrow).toMatchObject({ color: "#27ae60", size: 3, heads: DEFAULT_STYLES.arrow.heads });
    expect(styles.rect).toEqual(DEFAULT_STYLES.rect);
    expect(Object.keys(saved.toolStyles)).toEqual(["arrow"]);
  });

  it("read nothing from anything else", () => {
    expect(readEditorSettings(null)).toEqual({ toolStyles: {}, quickStyles: [] });
    expect(readEditorSettings({ quickStyles: [blueArrow] }).quickStyles).toEqual([blueArrow]);
  });
});
