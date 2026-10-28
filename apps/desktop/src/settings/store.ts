// The user settings, shared by every window. The backend stores them and
// announces each change with `settings:changed`, so all windows stay in step.
import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "../api";
import { resolveLanguage, setLanguage, systemLanguages } from "../i18n";

export const DEFAULT_SETTINGS: api.Settings = {
  language: null,
  captureHotkey: null,
  libraryDir: null,
  copyAfterCapture: true,
  editAfterCapture: true,
  editor: {},
};

let current = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

function apply(next: api.Settings) {
  current = next;
  setLanguage(resolveLanguage(next.language, systemLanguages()));
  listeners.forEach((listener) => listener());
}

/** Loads the settings and follows later changes; call once per window, before rendering. */
export async function loadSettings() {
  void listen<api.Settings>("settings:changed", (event) => apply(event.payload));
  apply((await api.getSettings()).settings);
}

export const getSettings = () => current;

/** Stores a change; rejects (and changes nothing) if the backend refuses it, e.g. a taken hotkey. */
export async function updateSettings(patch: Partial<api.Settings>): Promise<api.SettingsInfo> {
  const info = await api.saveSettings({ ...current, ...patch });
  apply(info.settings);
  return info;
}

/** Stores some of the editor's settings, keeping the rest. */
export const updateEditorSettings = (patch: Record<string, unknown>) =>
  updateSettings({ editor: { ...current.editor, ...patch } });

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useSettings = () => useSyncExternalStore(subscribe, getSettings);
