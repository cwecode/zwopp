import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import type { LibraryItem } from "./api";
import { Editor, type EditorHandle } from "./editor/Editor";
import { Library } from "./library/Library";
import { SettingsPage } from "./settings/SettingsPage";
import { useTrayLanguage } from "./trayLanguage";

type View = { kind: "library" } | api.RequestedView;

/** The main window: library, settings, or the editor for one item. */
export function App() {
  const [view, setView] = useState<View>({ kind: "library" });
  const editor = useRef<EditorHandle>(null);
  useTrayLanguage();

  /** Switches the view, saving the editor's changes first. */
  const show = useCallback(async (next: View) => {
    await editor.current?.flush();
    setView(next);
  }, []);

  // A finished capture opens in the editor (if the settings say so), and the
  // tray menu can open the settings. The request may come before this window
  // has loaded (it is created on demand), so it waits in the backend.
  useEffect(() => {
    const takeView = () =>
      api
        .takeView()
        .then((view) => view && show(view))
        .catch((e) => console.error("take_view failed", e));
    const unlisten = listen("app:view", takeView);
    void takeView();
    return () => void unlisten.then((fn) => fn());
  }, [show]);

  // A GIF cannot be edited yet; it stays in the library.
  const open = useCallback(
    (item: LibraryItem) => show(item.animationPath ? { kind: "library" } : { kind: "editor", item }),
    [show],
  );
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
          onOpen={(item) => setView(item.animationPath ? { kind: "library" } : { kind: "editor", item })}
          onSaved={onSaved}
        />
      );
    case "settings":
      return <SettingsPage onClose={toLibrary} />;
    case "library":
      return <Library onOpen={open} onSettings={() => setView({ kind: "settings" })} />;
  }
}
