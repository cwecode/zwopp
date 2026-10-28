import { describe, expect, it } from "vitest";
import { acceleratorFromEvent, type KeyPress } from "./accelerator";

const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("hotkeys from key presses", () => {
  it("name modifiers in a fixed order", () => {
    expect(acceleratorFromEvent(press("KeyX", { ctrlKey: true, shiftKey: true }))).toBe("CommandOrControl+Shift+X");
    expect(acceleratorFromEvent(press("Digit2", { metaKey: true, altKey: true, shiftKey: true }))).toBe(
      "CommandOrControl+Alt+Shift+2",
    );
  });

  it("need Ctrl/⌘ or Alt for keys that type", () => {
    expect(acceleratorFromEvent(press("KeyX"))).toBeNull();
    expect(acceleratorFromEvent(press("KeyX", { shiftKey: true }))).toBeNull();
    expect(acceleratorFromEvent(press("Space", { altKey: true }))).toBe("Alt+Space");
  });

  it("take function keys and Print on their own", () => {
    expect(acceleratorFromEvent(press("PrintScreen"))).toBe("PrintScreen");
    expect(acceleratorFromEvent(press("F9", { shiftKey: true }))).toBe("Shift+F9");
  });

  it("wait while only modifiers are held", () => {
    expect(acceleratorFromEvent(press("ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(acceleratorFromEvent(press("ShiftRight", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});
