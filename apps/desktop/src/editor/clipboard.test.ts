import { describe, expect, it } from "vitest";
import { getClipboard, nextPasteOffset, setClipboard } from "./clipboard";

describe("clipboard", () => {
  it("offsets repeated pastes per target item", () => {
    setClipboard({ sourceId: "a", shapes: [], assets: {} });
    expect(getClipboard()?.sourceId).toBe("a");
    expect(nextPasteOffset("b")).toBe(0);
    expect(nextPasteOffset("b")).toBe(24);
    // Pasting into the source never lands exactly on the original.
    expect(nextPasteOffset("a")).toBe(24);
    setClipboard({ sourceId: "a", shapes: [], assets: {} });
    expect(nextPasteOffset("b")).toBe(0);
  });
});
