// Typed wrappers around the Tauri commands in `src-tauri/src/commands.rs`.
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
  thumbPath: string;
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

const isMac = navigator.userAgent.includes("Mac");
const KEY_LABELS: Record<string, string> = isMac
  ? { CommandOrControl: "⌘", Shift: "⇧", Alt: "⌥" }
  : { CommandOrControl: "Strg", Shift: "Umschalt", Alt: "Alt" };

/** "CommandOrControl+Shift+X" → "Strg + Umschalt + X" (or "⌘ ⇧ X" on macOS). */
export const formatShortcut = (accelerator: string) =>
  accelerator
    .split("+")
    .map((key) => KEY_LABELS[key] ?? key)
    .join(isMac ? " " : " + ");

export const captureShortcut = () => invoke<string | null>("capture_shortcut");
export const startCapture = () => invoke<void>("start_capture");
export const overlayFrame = (index: number) => invoke<ArrayBuffer>("overlay_frame", { index });
export const finishCapture = (index: number, rect: Rect) =>
  invoke<LibraryItem>("finish_capture", { index, rect });
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

export const readOriginal = (id: string) => invoke<ArrayBuffer>("read_original", { id });
export const loadDocument = (id: string) => invoke<unknown>("load_document", { id });
export const saveDocument = (id: string, document: unknown) =>
  invoke<void>("save_document", { id, document });
export const saveAsset = (id: string, png: Uint8Array) =>
  invoke<string>("save_asset", png, { headers: { "item-id": id } });
export const readAsset = (id: string, name: string) => invoke<ArrayBuffer>("read_asset", { id, name });
export const saveRender =(id: string, png: Uint8Array) =>
  invoke<LibraryItem>("save_render", png, { headers: { "item-id": id } });

/** URL for showing a library file in an <img>; `version` busts the cache after edits. */
export const fileUrl = (path: string, version: string) =>
  `${convertFileSrc(path)}?v=${encodeURIComponent(version)}`;
