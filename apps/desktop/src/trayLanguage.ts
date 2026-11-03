import { useEffect } from "react";
import { setLanguage } from "./api";
import { useLanguage } from "./i18n";

/**
 * Keeps the tray menu in the language of the UI. The main window does it while
 * it exists, the first capture overlay always (the main window is closed most
 * of the time, and not opened at all after a start at login).
 */
export function useTrayLanguage(enabled = true) {
  const language = useLanguage();
  useEffect(() => {
    if (enabled) setLanguage(language).catch((e) => console.error("set_language failed", e));
  }, [language, enabled]);
}
