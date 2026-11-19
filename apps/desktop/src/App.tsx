import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import type { LibraryItem } from "./api";
import { Editor, type EditorHandle } from "./editor/Editor";
import { Library } from "./library/Library";
import { ReportPage } from "./report/ReportPage";
import { SettingsPage } from "./settings/SettingsPage";
import { updateSettings, useSettings } from "./settings/store";
import { WelcomePage } from "./settings/WelcomePage";
import { useTrayLanguage } from "./trayLanguage";

type View = { kind: "library" } | api.RequestedView;

/** The main window: library, settings, or the editor for one item. */
export function App() {
  const [view, setView] = useState<View>({ kind: "library" });
  const editor = useRef<EditorHandle>(null);
  useTrayLanguage();
  const { setupDone } = useSettings();
  /** The first-start setup is showing. */
  const [welcome, setWelcome] = useState(false);

  // A new user gets the setup once; someone who already has screenshots
  // (they used a version without it) does not.
  useEffect(() => {
    if (setupDone) return;
    api
      .countItems({})
      .then(async (count) => {
        if (count > 0) await updateSettings({ setupDone: true });
        else setWelcome(true);
      })
      .catch((e) => console.error("could not check for the first start", e));
  }, [setupDone]);

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

  if (welcome) return <WelcomePage onDone={() => setWelcome(false)} />;

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
      return <SettingsPage onClose={toLibrary} onReport={() => setView({ kind: "report" })} />;
    case "report":
      return <ReportPage onClose={toLibrary} />;
    case "library":
      return <Library onOpen={open} onSettings={() => setView({ kind: "settings" })} />;
  }
}
