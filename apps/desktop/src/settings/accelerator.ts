/** The parts of a keyboard event a hotkey is made of. */
export interface KeyPress {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Keys that may be a hotkey on their own: they never type text. */
const STANDALONE = /^(F\d{1,2}|PrintScreen|Pause)$/;
const NAMED = /^(Space|Insert|Home|End|PageUp|PageDown)$/;

/**
 * The Tauri accelerator for a key press, e.g. "CommandOrControl+Shift+X", or
 * null if it cannot be a global hotkey: only modifiers so far, an unsupported
 * key, or a typing key without Ctrl/⌘ or Alt (it would swallow that letter
 * everywhere).
 */
export function acceleratorFromEvent(event: KeyPress): string | null {
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  const key = letter ?? digit ?? (STANDALONE.test(event.code) || NAMED.test(event.code) ? event.code : null);
  if (!key) return null;
  const command = event.ctrlKey || event.metaKey;
  if (!command && !event.altKey && !STANDALONE.test(key)) return null;
  return [command && "CommandOrControl", event.altKey && "Alt", event.shiftKey && "Shift", key]
    .filter(Boolean)
    .join("+");
}
