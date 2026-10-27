// UI language: German or English, picked from the system's preferred
// languages. Texts live in de.tsx (the reference) and en.tsx.
import { useSyncExternalStore } from "react";
import { de } from "./de";
import { en } from "./en";

export type Messages = typeof de;
export type Language = "de" | "en";

export const MESSAGES: Record<Language, Messages> = { de, en };

/** The first supported language among `preferred` (BCP 47 tags, most preferred first), else English. */
export function detectLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const primary = tag.split("-")[0].toLowerCase();
    if (primary in MESSAGES) return primary as Language;
  }
  return "en";
}

// Unit tests run in Node, without a document.
const inBrowser = typeof document !== "undefined";
let language = inBrowser ? detectLanguage(navigator.languages.length ? navigator.languages : [navigator.language]) : "de";
const listeners = new Set<() => void>();
if (inBrowser) document.documentElement.lang = language;

export const getLanguage = () => language;

/** Switches the language of this window; components using `useT` re-render. */
export function setLanguage(next: Language) {
  if (next === language) return;
  language = next;
  if (inBrowser) document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useLanguage = () => useSyncExternalStore(subscribe, getLanguage);

/** The texts of the current language. */
export const useT = (): Messages => MESSAGES[useLanguage()];

const isMac = inBrowser && navigator.userAgent.includes("Mac");
const MAC_KEYS: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", del: "⌫" };

/**
 * Names a key combination for tooltips and messages: `["mod", "shift", "Z"]`
 * → "Strg+Umschalt+Z", "Ctrl+Shift+Z" or "⌘⇧Z" on macOS. `mod`, `shift`,
 * `alt`, `del` and `wheel` are translated, anything else is used as is.
 */
export function keys(t: Messages, combo: string[], mac = isMac): string {
  const names = t.keys as Record<string, string>;
  if (!mac) return combo.map((key) => names[key] ?? key).join("+");
  // macOS writes symbols and single keys without a separator: ⌘⇧Z, but ⌘+Mausrad.
  const parts = combo.map((key) => MAC_KEYS[key] ?? names[key] ?? key);
  return parts.reduce((text, part, i) => {
    const joined = i > 0 && combo[i - 1] in MAC_KEYS && [...part].length === 1;
    return i === 0 || joined ? text + part : `${text}+${part}`;
  }, "");
}

/** A Tauri accelerator for display: "CommandOrControl+Shift+X" → "Strg + Umschalt + X" or "⌘ ⇧ X". */
export function formatAccelerator(t: Messages, accelerator: string, mac = isMac): string {
  const tokens: Record<string, keyof Messages["keys"]> = { CommandOrControl: "mod", Shift: "shift", Alt: "alt" };
  return accelerator
    .split("+")
    .map((key) => {
      const token = tokens[key];
      if (!token) return key;
      return mac ? MAC_KEYS[token] : t.keys[token];
    })
    .join(mac ? " " : " + ");
}
