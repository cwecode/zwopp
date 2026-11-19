// The same three ways on in every view of the main window: a new screenshot,
// the library and the editor, each one click away.
import * as api from "./api";
import { useT } from "./i18n";

export type Place = "library" | "editor" | "other";

export interface Navigation {
  /** Shows the library. */
  library(): void;
  /** Opens the editor: the screenshot edited last, else the newest one. */
  editor(): void;
}

export function AppNav({
  at,
  nav,
  capture = true,
}: {
  at: Place;
  nav: Navigation;
  /** The library has its own screenshot button, with a delay. */
  capture?: boolean;
}) {
  const t = useT();
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
      {capture && (
        <button
          className="primary"
          title={t.nav.captureTitle}
          onClick={() => api.startCapture().catch((e) => console.error("could not start the capture", e))}
        >
          <span aria-hidden="true">📷</span> {t.nav.capture}
        </button>
      )}
    </nav>
  );
}
