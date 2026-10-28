import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { setLanguage, type LibraryItem } from "./api";
import { Editor, type EditorHandle } from "./editor/Editor";
import { useLanguage } from "./i18n";
import { Library } from "./library/Library";
import { SettingsPage } from "./settings/SettingsPage";

type View = { kind: "library" } | { kind: "settings" } | { kind: "editor"; item: LibraryItem };

/** The main window: library, settings, or the editor for one item. */
export function App() {
  const [view, setView] = useState<View>({ kind: "library" });
  const editor = useRef<EditorHandle>(null);
  const language = useLanguage();

  // The tray menu follows the language of the UI.
  useEffect(() => {
    setLanguage(language).catch((e) => console.error("set_language failed", e));
  }, [language]);

  /** Switches the view, saving the editor's changes first. */
  const show = useCallback(async (next: View) => {
    await editor.current?.flush();
    setView(next);
  }, []);

  // A finished capture opens in the editor (if the settings say so), and the
  // tray menu can open the settings.
  useEffect(() => {
    const unlisten = Promise.all([
      listen<LibraryItem>("capture:edit", (event) => void show({ kind: "editor", item: event.payload })),
      listen("app:settings", () => void show({ kind: "settings" })),
    ]);
    return () => void unlisten.then((fns) => fns.forEach((fn) => fn()));
  }, [show]);

  const open = useCallback((item: LibraryItem) => show({ kind: "editor", item }), [show]);
  const toLibrary = useCallback(() => setView({ kind: "library" }), []);
  // Only refreshes the item while it is still open.
  const onSaved = useCallback(
    (item: LibraryItem) =>
      setView((v) => (v.kind === "editor" && v.item.id === item.id ? { kind: "editor", item } : v)),
    [],
  );

  switch (view.kind) {
    case "editor":
      return (
        <Editor
          key={view.item.id}
          ref={editor}
          item={view.item}
          onClose={toLibrary}
          onOpen={(item) => setView({ kind: "editor", item })}
          onSaved={onSaved}
        />
      );
    case "settings":
      return <SettingsPage onClose={toLibrary} />;
    case "library":
      return <Library onOpen={open} onSettings={() => setView({ kind: "settings" })} />;
  }
}
