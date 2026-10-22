import type { Shape } from "./document";

export type Tool = "select" | "arrow" | "rect" | "text" | "highlight" | "blur";

export const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: "select", label: "Auswählen", key: "v", icon: "↖" },
  { id: "arrow", label: "Pfeil", key: "a", icon: "➚" },
  { id: "rect", label: "Rechteck", key: "r", icon: "▭" },
  { id: "text", label: "Text", key: "t", icon: "T" },
  { id: "highlight", label: "Marker", key: "h", icon: "▬" },
  { id: "blur", label: "Verpixeln", key: "b", icon: "▦" },
];

export const COLORS = ["#e5322d", "#f2994a", "#f2c94c", "#27ae60", "#2f80ed", "#1d1d1b", "#ffffff"];

/** Default marker colour; a pale yellow reads well with multiply blending. */
export const HIGHLIGHT_COLOR = "#f2c94c";

/** One "size" control drives stroke width, font size and blur strength. */
export const SIZES = [
  { label: "S", strokeWidth: 3, fontSize: 18, pixelSize: 6 },
  { label: "M", strokeWidth: 5, fontSize: 26, pixelSize: 10 },
  { label: "L", strokeWidth: 8, fontSize: 36, pixelSize: 16 },
  { label: "XL", strokeWidth: 12, fontSize: 52, pixelSize: 24 },
];

export interface ToolStyle {
  color: string;
  size: number;
}

/** The style properties of `shape` that follow the toolbar's colour and size. */
export function stylePatch(shape: Shape, style: Partial<ToolStyle>): Partial<Shape> {
  const size = style.size === undefined ? undefined : SIZES[style.size];
  switch (shape.type) {
    case "arrow":
    case "rect":
      return {
        ...(style.color && { stroke: style.color }),
        ...(size && { strokeWidth: size.strokeWidth }),
      };
    case "text":
      return {
        ...(style.color && { fill: style.color }),
        ...(size && { fontSize: size.fontSize }),
      };
    case "highlight":
      return style.color ? { fill: style.color } : {};
    case "blur":
      return size ? { pixelSize: size.pixelSize } : {};
  }
}
