// Typed wrappers around the Tauri commands in `src-tauri/src/commands.rs`.
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface LibraryItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  width: number;
  height: number;
  title: string;
  favorite: boolean;
  tags: string[];
  hasAnnotations: boolean;
  originalPath: string;
  renderPath: string | null;
}

export interface ListQuery {
  search?: string;
  favoritesOnly?: boolean;
}

export interface ItemUpdate {
  title?: string;
  favorite?: boolean;
  tags?: string[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tells the backend the UI language, for the tray menu. */
export const setLanguage = (language: string) => invoke<void>("set_language", { language });

/** The user settings (`zwopp_core::settings::Settings`). */
export interface Settings {
  /** "de" or "en"; null follows the system. */
  language: string | null;
  /** Tauri accelerator, e.g. "CommandOrControl+Shift+X"; null = first free default. */
  captureHotkey: string | null;
  /** null = the default folder. */
  libraryDir: string | null;
  copyAfterCapture: boolean;
  editAfterCapture: boolean;
  /** Owned by the editor (see `editor/quickStyles.ts`). */
  editor: Record<string, unknown>;
}

export interface SettingsInfo {
  settings: Settings;
  /** The library folder in use; a changed setting applies after a restart. */
  libraryDir: string;
  defaultLibraryDir: string;
  /** ZWOPP_LIBRARY_DIR is set and wins over the setting. */
  libraryDirFromEnv: boolean;
  captureShortcut: string | null;
}

export const getSettings = () => invoke<SettingsInfo>("get_settings");
/** Applies and stores the settings; rejects (keeping the old hotkey) if the hotkey is taken. */
export const saveSettings = (settings: Settings) => invoke<SettingsInfo>("save_settings", { settings });
export const pickFolder = (title: string, start?: string) => invoke<string | null>("pick_folder", { title, start });
/** Asks where to save a JSON file; resolves to the path, or null if cancelled. */
export const saveTextFile = (title: string, name: string, contents: string) =>
  invoke<string | null>("save_text_file", { title, name, contents });
/** Asks for a JSON file; resolves to its contents, or null if cancelled. */
export const openTextFile = (title: string) => invoke<string | null>("open_text_file", { title });
export const restart = () => invoke<void>("restart");

export const captureShortcut = () => invoke<string | null>("capture_shortcut");
/** Starts a capture, after `delay` seconds if given. */
export const startCapture = (delay?: number) => invoke<void>("start_capture", { delay });
export const overlayFrame = (index: number) => invoke<ArrayBuffer>("overlay_frame", { index });

/** Monitors and windows of the running capture, in desktop pixels (shared by all monitors). */
export interface CaptureLayout {
  monitors: Rect[];
  /** Visible windows, topmost first. */
  windows: Rect[];
}

export const captureLayout = () => invoke<CaptureLayout>("capture_layout");

/** Saves `rect` (desktop pixels, may span monitors) as a new library item. */
export const finishCapture = (rect: Rect) => invoke<LibraryItem>("finish_capture", { rect });
export const cancelCapture = () => invoke<void>("cancel_capture");

/** One page of the library, newest first. */
export const listItems = (query: ListQuery, offset: number, limit: number) =>
  invoke<LibraryItem[]>("list_items", { query, offset, limit });
export const countItems = (query: ListQuery) => invoke<number>("count_items", { query });
/** Index of an item in the list for `query`, or null if it does not match. */
export const itemPosition = (id: string, query: ListQuery = {}) =>
  invoke<number | null>("item_position", { id, query });
export const listTags = () => invoke<string[]>("list_tags");
export const updateItem = (id: string, update: ItemUpdate) =>
  invoke<LibraryItem>("update_item", { id, update });
export const deleteItem = (id: string) => invoke<void>("delete_item", { id });
export const copyItem = (id: string) => invoke<void>("copy_item", { id });

/**
 * Asks where to save the item and writes it as PNG, JPEG or WebP (by the
 * chosen extension). Resolves to the path, or null if cancelled.
 */
export const exportItem = (id: string, title: string) => invoke<string | null>("export_item", { id, title });

/**
 * Drags the item into another app as a PNG file named after its title.
 * Call it from `dragstart` (after `preventDefault`) while the mouse is down.
 */
export async function dragOut(id: string) {
  const { file, icon } = await invoke<{ file: string; icon: string }>("drag_file", { id });
  await startDrag({ item: [file], icon, mode: "copy" });
}

export const readOriginal = (id: string) => invoke<ArrayBuffer>("read_original", { id });
export const loadDocument = (id: string) => invoke<unknown>("load_document", { id });
export const saveDocument = (id: string, document: unknown) =>
  invoke<void>("save_document", { id, document });
export const saveAsset = (id: string, png: Uint8Array) =>
  invoke<string>("save_asset", png, { headers: { "item-id": id } });
export const readAsset = (id: string, name: string) => invoke<ArrayBuffer>("read_asset", { id, name });
export const saveRender =(id: string, png: Uint8Array) =>
  invoke<LibraryItem>("save_render", png, { headers: { "item-id": id } });

/** Thumbnail URL for the library grid and filmstrip (served by `thumbs.rs`). */
export const thumbUrl = (item: LibraryItem) =>
  `${convertFileSrc(item.id, "thumb")}?v=${encodeURIComponent(item.updatedAt)}`;

/** URL for showing a library file in an <img>; `version` busts the cache after edits. */
export const fileUrl = (path: string, version: string) =>
  `${convertFileSrc(path)}?v=${encodeURIComponent(version)}`;
