import { describe, expect, it } from "vitest";
import { DISCOVER_AFTER, NEW_GUIDE, frontTool, hasNews, nextTip, pickTool, readGuide, type Guide } from "./guide";
import { FAMILIES, TOOLS, familyOf } from "./tools";

describe("tool families", () => {
  it("hold every tool exactly once", () => {
    const tools = FAMILIES.flatMap((f) => f.tools);
    expect(new Set(tools).size).toBe(tools.length);
    expect([...tools].sort()).toEqual(TOOLS.map((t) => t.id).sort());
    expect(familyOf("pen").id).toBe("arrow");
  });

  it("show the tool picked last, else their first", () => {
    expect(frontTool(NEW_GUIDE, "shape")).toBe("rect");
    const guide = pickTool(NEW_GUIDE, "ellipse", "shape");
    expect(frontTool(guide, "shape")).toBe("ellipse");
    expect(guide.used.ellipse).toBe(1);
  });

  it("point out unused tools after some use, until the menu is opened", () => {
    let guide: Guide = NEW_GUIDE;
    for (let i = 0; i < DISCOVER_AFTER - 1; i++) guide = pickTool(guide, "arrow", "arrow");
    expect(hasNews(guide, "arrow")).toBe(false);
    guide = pickTool(guide, "arrow", "arrow");
    expect(hasNews(guide, "arrow")).toBe(true);
    expect(hasNews({ ...guide, openedFamilies: ["arrow"] }, "arrow")).toBe(false);
    // Nothing to point out once every tool was used, or with only one tool.
    expect(hasNews(pickTool(pickTool(guide, "line", "arrow"), "pen", "arrow"), "arrow")).toBe(false);
    expect(hasNews(pickTool(guide, "select", "select"), "select")).toBe(false);
  });
});

describe("tips", () => {
  const context = { tool: "arrow" as const, steps: 0, styleChanges: 0 };

  it("come one at a time, each once, when they help", () => {
    expect(nextTip(NEW_GUIDE, context)).toBe("families");
    const seen = { ...NEW_GUIDE, seenTips: ["families"] };
    expect(nextTip(seen, context)).toBeNull();
    expect(nextTip(seen, { ...context, tool: "step", steps: 2 })).toBe("stepRepeat");
    expect(nextTip(seen, { ...context, styleChanges: 4 })).toBe("quickStyles");
    expect(nextTip({ ...seen, seenTips: ["families", "quickStyles"] }, { ...context, styleChanges: 9 })).toBeNull();
  });
});

describe("readGuide", () => {
  it("keeps valid fields and drops the rest", () => {
    const guide = readGuide({
      guide: {
        used: { arrow: 3, nope: 2, line: -1 },
        front: { shape: "ellipse", arrow: "rect", foo: "pen" },
        seenTips: ["families", 4],
        openedFamilies: ["arrow", "nope"],
        allTools: true,
        showLayers: "yes",
      },
    });
    expect(guide).toEqual({
      used: { arrow: 3 },
      front: { shape: "ellipse" },
      seenTips: ["families"],
      openedFamilies: ["arrow"],
      allTools: true,
      showLayers: false,
    });
    expect(readGuide(undefined)).toEqual(NEW_GUIDE);
  });
});
