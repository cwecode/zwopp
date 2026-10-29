// Mouse stamps for step-by-step instructions. The drawing is defined once as
// SVG path data in a 24 × 32 box, so the canvas (EditorCanvas) and the
// toolbar picker (StampIcon) show exactly the same symbol.

export type StampKind = "left" | "right" | "middle" | "double" | "scroll" | "drag";

/** In picker order; the names are in the translations (`editor.stamps`). */
export const STAMPS: StampKind[] = ["left", "right", "double", "middle", "scroll", "drag"];

export const STAMP_BOX = { width: 24, height: 32 };

/** Outline of the mouse body. */
export const BODY = "M12 1C5.9 1 2 5.5 2 11V21C2 27 6.4 31 12 31C17.6 31 22 27 22 21V11C22 5.5 18.1 1 12 1Z";
/** The lines between the buttons and the body. */
export const DIVIDERS = "M2 13H22M12 1V4.5M12 10.5V13";
const LEFT = "M12 1C5.9 1 2 5.5 2 11V13H12Z";
const RIGHT = "M12 1C18.1 1 22 5.5 22 11V13H12Z";
export const WHEEL = "M12 4.5A1.5 1.5 0 0 1 13.5 6V9A1.5 1.5 0 0 1 10.5 9V6A1.5 1.5 0 0 1 12 4.5Z";

export interface StampDrawing {
  /** Areas filled with the stamp's colour. */
  fills: string[];
  /** Lines drawn in the stamp's colour on the lower body. */
  marks?: string;
  /** Text on the lower body, in the stamp's colour. */
  label?: string;
}

export const STAMP_DRAWINGS: Record<StampKind, StampDrawing> = {
  left: { fills: [LEFT] },
  right: { fills: [RIGHT] },
  middle: { fills: [WHEEL] },
  double: { fills: [LEFT], label: "2×" },
  scroll: { fills: [WHEEL], marks: "M8 20L12 16.5L16 20M8 23.5L12 27L16 23.5" },
  drag: {
    fills: [LEFT],
    marks: "M12 15.5V27.5M6 21.5H18M10 17.5L12 15.5L14 17.5M10 25.5L12 27.5L14 25.5M8 19.5L6 21.5L8 23.5M16 19.5L18 21.5L16 23.5",
  },
};

/** Line width of the outline and marks, in box units. */
export const STAMP_LINE = 1.6;
/** Colour of the outline; the body itself is white. */
export const STAMP_OUTLINE = "#1d1d1b";
