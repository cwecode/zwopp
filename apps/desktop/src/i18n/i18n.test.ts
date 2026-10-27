import { describe, expect, it } from "vitest";
import { detectLanguage, formatAccelerator, keys, MESSAGES } from ".";

const { de, en } = MESSAGES;

/** Paths of all texts, e.g. "editor.status.saved". */
function paths(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, v]) =>
    typeof v === "object" && v !== null ? paths(v, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

describe("i18n", () => {
  it("has the same texts in every language", () => {
    expect(paths(en).sort()).toEqual(paths(de).sort());
  });

  it("picks the first supported language", () => {
    expect(detectLanguage(["de-AT", "en"])).toBe("de");
    expect(detectLanguage(["fr-FR", "de-DE"])).toBe("de");
    expect(detectLanguage(["en-GB", "de"])).toBe("en");
    expect(detectLanguage(["fr", "it"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });

  it("names key combinations", () => {
    expect(keys(de, ["mod", "shift", "Z"], false)).toBe("Strg+Umschalt+Z");
    expect(keys(en, ["mod", "shift", "Z"], false)).toBe("Ctrl+Shift+Z");
    expect(keys(de, ["del"], false)).toBe("Entf");
    expect(keys(en, ["mod", "+"], false)).toBe("Ctrl++");
    expect(keys(de, ["mod", "shift", "Z"], true)).toBe("⌘⇧Z");
    expect(keys(de, ["mod", "wheel"], true)).toBe("⌘+Mausrad");
  });

  it("formats accelerators", () => {
    expect(formatAccelerator(de, "CommandOrControl+Shift+X", false)).toBe("Strg + Umschalt + X");
    expect(formatAccelerator(en, "CommandOrControl+Alt+X", false)).toBe("Ctrl + Alt + X");
    expect(formatAccelerator(en, "CommandOrControl+Shift+X", true)).toBe("⌘ ⇧ X");
  });

  it("counts in the language", () => {
    expect(de.library.count(1)).toBe("1 Screenshot");
    expect(de.library.count(24_999)).toBe("24.999 Screenshots");
    expect(en.library.count(24_999)).toBe("24,999 screenshots");
  });
});
