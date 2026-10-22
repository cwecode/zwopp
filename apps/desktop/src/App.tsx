import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { LibraryItem } from "./api";
import { Editor, type EditorHandle } from "./editor/Editor";
import { Library } from "./library/Library";

/** The main window: library, or the editor for one item. */
export function App() {
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const editor = useRef<EditorHandle>(null);

  const open = useCallback(async (item: LibraryItem) => {
    // Save the current item before switching to another one.
    await editor.current?.flush();
    setEditing(item);
  }, []);

  // A finished capture opens straight in the editor.
  useEffect(() => {
    const unlisten = listen<LibraryItem>("library:changed", (event) => void open(event.payload));
    return () => void unlisten.then((fn) => fn());
  }, [open]);

  const onSaved = useCallback((item: LibraryItem) => setEditing(item), []);

  return editing ? (
    <Editor
      key={editing.id}
      ref={editor}
      item={editing}
      onClose={() => setEditing(null)}
      onSaved={onSaved}
    />
  ) : (
    <Library onOpen={open} />
  );
}
