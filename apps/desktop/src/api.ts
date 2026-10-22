// Typed wrappers around the Tauri commands in `src-tauri/src/commands.rs`.
import { invoke } from "@tauri-apps/api/core";

export interface LibraryItem {
  id: string;
  createdAt: string;
  width: number;
  height: number;
  originalPath: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CAPTURE_SHORTCUT_LABEL = navigator.userAgent.includes("Mac")
  ? "⌘ ⇧ X"
  : "Strg + Umschalt + X";

export const startCapture = () => invoke<void>("start_capture");
export const overlayFrame = (index: number) => invoke<ArrayBuffer>("overlay_frame", { index });
export const finishCapture = (index: number, rect: Rect) =>
  invoke<LibraryItem>("finish_capture", { index, rect });
export const cancelCapture = () => invoke<void>("cancel_capture");
export const listItems = () => invoke<LibraryItem[]>("list_items");
export const deleteItem = (id: string) => invoke<void>("delete_item", { id });
