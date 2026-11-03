// The colour theme: light, dark, or the system's. The stylesheet follows
// `data-theme` on the root element; without it, the system's preference.
import { useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Theme } from "../api";

/** Remembers the theme per window, so the next start shows it before the settings load. */
const THEME_KEY = "zwopp.theme";

const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";

/** Applies `theme` (null = the system's) to the page and the window frame. */
export function applyTheme(theme: Theme | null) {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    if (theme) localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // Only a faster start is lost.
  }
  // The title bar follows too; not every platform supports it.
  getCurrentWindow()
    .setTheme(theme)
    .catch(() => {});
}

/** The theme from the last start, for the first paint. */
export function rememberedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Whether the page shows the dark theme; follows the system while `theme` is null. */
export function useSystemDark(theme: Theme | null): boolean {
  const systemDark = useSyncExternalStore(
    (onChange) => {
      const query = darkQuery();
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => darkQuery().matches,
  );
  return theme ? theme === "dark" : systemDark;
}
