import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, initHistory, push, redo, undo } from "./history";

describe("history", () => {
  it("undoes and redoes steps", () => {
    let h = push(push(initHistory(1), 2), 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(undo(h)).toBe(h);
    h = redo(redo(h));
    expect(h.present).toBe(3);
    expect(redo(h)).toBe(h);
  });

  it("drops redo steps on a new change", () => {
    const h = push(undo(push(initHistory("a"), "b")), "c");
    expect(h.present).toBe("c");
    expect(h.future).toEqual([]);
    expect(h.past).toEqual(["a"]);
  });

  it("ignores unchanged values", () => {
    const h = initHistory({ n: 1 });
    expect(push(h, h.present)).toBe(h);
  });

  it("is bounded", () => {
    let h = initHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = push(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});
