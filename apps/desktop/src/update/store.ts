// The update on offer, shared by the toast in the library, the dot on the
// settings button and the button in the settings. The backend looks for
// updates by itself and announces one with `update:available`.
import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "../api";

export interface UpdateState {
  /** False in a development build, which does not look for updates. */
  enabled: boolean;
  available: api.AvailableUpdate | null;
  checking: boolean;
  /** Set after a check by hand found nothing. */
  upToDate: boolean;
  installing: boolean;
  /** Download progress, 0–100, once the size is known. */
  percent?: number;
  error?: string;
  /** The version whose toast was closed; it comes back on the next start. */
  dismissed?: string;
}

let state: UpdateState = { enabled: false, available: null, checking: false, upToDate: false, installing: false };
const listeners = new Set<() => void>();
let started = false;

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

/** Loads the state and follows the backend; runs once per window. */
function start() {
  if (started) return;
  started = true;
  api
    .updateStatus()
    .then((status) => set({ enabled: status.enabled, available: status.available ?? state.available }))
    .catch(() => {});
  void listen<api.AvailableUpdate>("update:available", (e) => set({ available: e.payload, upToDate: false }));
  void listen<api.UpdateProgress>("update:progress", (e) => {
    const { downloaded, total } = e.payload;
    set({ percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined });
  });
  void listen<string>("update:failed", (e) => set({ installing: false, percent: undefined, error: e.payload }));
}

/** Looks for an update now. */
export async function checkForUpdate() {
  set({ checking: true, upToDate: false, error: undefined });
  try {
    const found = await api.checkUpdate();
    set({ available: found ?? state.available, upToDate: !found });
  } catch (e) {
    set({ error: String(e) });
  } finally {
    set({ checking: false });
  }
}

/** Downloads and installs the update; Zwopp restarts when it is done. */
export function installUpdate() {
  set({ installing: true, percent: undefined, error: undefined });
  api.installUpdate().catch((e) => set({ installing: false, error: String(e) }));
}

/** Closes the toast for this version until the next start. */
export const dismissUpdate = () => set({ dismissed: state.available?.version });

const subscribe = (listener: () => void) => {
  start();
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useUpdate = () => useSyncExternalStore(subscribe, () => state);
