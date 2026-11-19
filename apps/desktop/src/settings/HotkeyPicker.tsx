import { useEffect, useState } from "react";
import * as api from "../api";
import { formatAccelerator, useT } from "../i18n";
import { acceleratorFromEvent } from "./accelerator";
import { updateSettings, useSettings } from "./store";

/** The built-in hotkeys, tried in this order (`CAPTURE_SHORTCUTS` in settings.rs). */
export const DEFAULT_HOTKEYS = ["CommandOrControl+Shift+X", "CommandOrControl+Alt+X", "CommandOrControl+Shift+2"];
const PRINT = "PrintScreen";

/**
 * Picking the capture hotkey, in the settings and the first-start setup alike:
 * press a combination, go back to the default, or (Windows) take the Print key
 * from the Snipping Tool. Combinations other programs or the system rely on
 * are refused with a reason (ADR 0014).
 */
export function HotkeyPicker({
  shortcut,
  onChange,
  onMessage,
}: {
  /** The hotkey in effect. */
  shortcut: string | null | undefined;
  onChange(info: api.SettingsInfo): void;
  onMessage(message: string | undefined): void;
}) {
  const t = useT();
  const wanted = useSettings().captureHotkey;
  const [recording, setRecording] = useState(false);
  /** Whether the Snipping Tool has the Print key; null off Windows. */
  const [snipping, setSnipping] = useState<boolean | null>(null);

  useEffect(() => {
    api.printKeyForSnipping().then(setSnipping).catch(() => setSnipping(null));
  }, []);

  /** Sets `accelerator` (null: the default) and explains why, if it cannot be. */
  const choose = async (accelerator: string | null) => {
    if (accelerator) {
      const reason = await api.hotkeyCheck(accelerator);
      if (reason) return onMessage(t.settings.hotkeyReserved[reason]);
    }
    try {
      onChange(await updateSettings({ captureHotkey: accelerator }));
      onMessage(undefined);
    } catch {
      onMessage(t.settings.hotkeyTaken(formatAccelerator(t, accelerator ?? DEFAULT_HOTKEYS[0])));
    }
  };

  const takePrintKey = async () => {
    try {
      await api.setPrintKeyForSnipping(false);
      setSnipping(false);
      await choose(PRINT);
      onMessage(t.settings.printKeyTaken);
    } catch (e) {
      onMessage(String(e));
    }
  };

  const givePrintKeyBack = async () => {
    try {
      await api.setPrintKeyForSnipping(true);
      setSnipping(true);
      if (shortcut === PRINT) await choose(null);
    } catch (e) {
      onMessage(String(e));
    }
  };

  // While recording, the next valid key combination becomes the hotkey.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      const accelerator = acceleratorFromEvent(e);
      if (!accelerator) return;
      setRecording(false);
      void choose(accelerator);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <>
      <div className="setting-value">
        {recording ? (
          <kbd className="recording">{t.settings.hotkeyRecording}</kbd>
        ) : shortcut ? (
          <kbd>{formatAccelerator(t, shortcut)}</kbd>
        ) : (
          <em>{t.settings.hotkeyNone}</em>
        )}
        <button onClick={() => setRecording((r) => !r)} aria-pressed={recording}>
          {t.settings.hotkeyChange}
        </button>
        <button
          disabled={wanted === null}
          title={t.settings.hotkeyDefaultTitle(DEFAULT_HOTKEYS.map((h) => formatAccelerator(t, h)).join(", "))}
          onClick={() => void choose(null)}
        >
          {t.settings.hotkeyDefault}
        </button>
      </div>
      <p className="hint">
        {wanted && shortcut !== wanted ? t.settings.hotkeyFallback(formatAccelerator(t, wanted)) : t.settings.hotkeyHint}
      </p>
      {snipping !== null && (
        <div className="setting-value">
          {shortcut === PRINT && !snipping ? (
            <button onClick={() => void givePrintKeyBack()}>{t.settings.printKeyGiveBack}</button>
          ) : (
            <button onClick={() => void takePrintKey()}>{t.settings.printKeyTake}</button>
          )}
          <span className="hint">{t.settings.printKeyTakeHint}</span>
        </div>
      )}
    </>
  );
}
