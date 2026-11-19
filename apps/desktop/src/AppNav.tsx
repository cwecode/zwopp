// The same bar at the same place in every view of the main window: the
// library, the editor and a new screenshot, each one click away. Nothing in
// it changes size between views, so the buttons do not jump.
import { useEffect, useState } from "react";
import * as api from "./api";
import { Popover } from "./editor/Popover";
import { formatAccelerator, useT } from "./i18n";

export type Place = "library" | "editor" | "other";

export interface Navigation {
  /** Shows the library. */
  library(): void;
  /** Opens the editor: the screenshot edited last, else the newest one. */
  editor(): void;
}

/** Capture delays offered next to "Screenshot", in seconds (0 = now). */
const DELAYS = [0, 3, 5, 10];
const DELAY_KEY = "zwopp.captureDelay";

/** The delay picked last time; a per-user convenience, so storage may fail. */
function storedDelay(): number {
  try {
    const value = Number(localStorage.getItem(DELAY_KEY));
    return DELAYS.includes(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function AppNav({ at, nav }: { at: Place; nav: Navigation }) {
  const t = useT();
  const [delay, setDelay] = useState(storedDelay);
  const [accelerator, setAccelerator] = useState<string | null>(null);

  useEffect(() => {
    api
      .captureShortcut()
      .then(setAccelerator)
      .catch((e) => console.error("could not read the capture shortcut", e));
  }, []);

  const pick = (seconds: number) => {
    setDelay(seconds);
    try {
      localStorage.setItem(DELAY_KEY, String(seconds));
    } catch {
      // Not remembered; still used now.
    }
  };

  return (
    <nav className="app-nav" aria-label={t.nav.label}>
      <div className="app-nav-views">
        <button
          aria-current={at === "library" ? "page" : undefined}
          title={t.nav.libraryTitle}
          onClick={() => at !== "library" && nav.library()}
        >
          <span aria-hidden="true">📚</span> {t.nav.library}
        </button>
        <button
          aria-current={at === "editor" ? "page" : undefined}
          title={t.nav.editorTitle}
          onClick={() => at !== "editor" && nav.editor()}
        >
          <span aria-hidden="true">✏️</span> {t.nav.editor}
        </button>
      </div>
      <div className="split-button">
        <button
          className="primary"
          title={accelerator ? t.library.newScreenshotTitle(formatAccelerator(t, accelerator)) : t.nav.captureTitle}
          onClick={() => api.startCapture(delay).catch((e) => console.error("could not start the capture", e))}
        >
          <span aria-hidden="true">📷</span> {t.nav.capture}
          {delay > 0 && <span className="delay-badge">{t.library.delaySeconds(delay)}</span>}
        </button>
        <Popover className="primary" label="▾" title={t.library.delay}>
          {(close) => (
            <div className="menu" role="menu" aria-label={t.library.delay}>
              {DELAYS.map((s) => (
                <button
                  key={s}
                  role="menuitemradio"
                  aria-checked={delay === s}
                  className={delay === s ? "active" : undefined}
                  onClick={() => {
                    pick(s);
                    close();
                  }}
                >
                  {s ? t.library.delaySeconds(s) : t.library.delayNone}
                </button>
              ))}
            </div>
          )}
        </Popover>
      </div>
    </nav>
  );
}
