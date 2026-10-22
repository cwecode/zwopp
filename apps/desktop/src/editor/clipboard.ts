// In-app clipboard for annotations. It lives outside React so it survives
// switching between library items in the editor.
import type { Shape } from "./document";

export interface ClipboardContent {
  /** Item the content was copied from. */
  sourceId: string;
  shapes: Shape[];
  /** PNG bytes for image shapes, keyed by their `asset` value. */
  assets: Record<string, Uint8Array>;
}

let content: ClipboardContent | null = null;
/** How often the current content was pasted into each item, for offsetting. */
let pastes = new Map<string, number>();

export function setClipboard(next: ClipboardContent) {
  content = next;
  pastes = new Map();
}

export function getClipboard(): ClipboardContent | null {
  return content;
}

/**
 * Offset for the next paste into `itemId`: pasted blocks keep their position,
 * except repeated pastes into the same item (or into the source) are shifted
 * so they do not land exactly on top of each other.
 */
export function nextPasteOffset(itemId: string): number {
  if (!content) return 0;
  const count = pastes.get(itemId) ?? (itemId === content.sourceId ? 1 : 0);
  pastes.set(itemId, count + 1);
  return count * 24;
}
