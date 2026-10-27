import { arrowHeads, type ArrowHead, type Shape } from "./document";

export type Tool = "select" | "arrow" | "line" | "rect" | "ellipse" | "text" | "highlight" | "blur";

/** The tools in toolbar order; their names are in the translations (`tools`). */
export const TOOLS: { id: Tool; key: string; icon: string }[] = [
  { id: "select", key: "v", icon: "↖" },
  { id: "arrow", key: "a", icon: "➚" },
  { id: "line", key: "l", icon: "╱" },
  { id: "rect", key: "r", icon: "▭" },
  { id: "ellipse", key: "e", icon: "◯" },
  { id: "text", key: "t", icon: "T" },
  { id: "highlight", key: "h", icon: "▬" },
  { id: "blur", key: "b", icon: "▦" },
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

export interface ArrowHeads {
  start: ArrowHead;
  end: ArrowHead;
}

/** The arrowhead choices in the toolbar; `id` names them in the translations (`editor.headStyles`). */
export const HEADS: ({ id: "none" | "end" | "both" | "endOpen" | "bothOpen" } & ArrowHeads)[] = [
  { id: "none", start: "none", end: "none" },
  { id: "end", start: "none", end: "filled" },
  { id: "both", start: "filled", end: "filled" },
  { id: "endOpen", start: "none", end: "open" },
  { id: "bothOpen", start: "open", end: "open" },
];

export interface ToolStyle {
  color: string;
  size: number;
  /** Rectangles and ellipses: filled with the colour instead of outlined. */
  filled?: boolean;
  /** Lines and arrows. */
  heads?: ArrowHeads;
}

/** The tool whose style a shape follows: a line without heads is a "line". */
export function toolOf(shape: Shape): Tool | null {
  switch (shape.type) {
    case "arrow": {
      const { start, end } = arrowHeads(shape);
      return start === "none" && end === "none" ? "line" : "arrow";
    }
    case "image":
      return null;
    default:
      return shape.type;
  }
}

/** The style properties of `shape` that follow the toolbar's colour and size. */
export function stylePatch(shape: Shape, style: Partial<ToolStyle>): Partial<Shape> {
  const size = style.size === undefined ? undefined : SIZES[style.size];
  switch (shape.type) {
    case "arrow":
      return {
        ...(style.color && { stroke: style.color }),
        ...(size && { strokeWidth: size.strokeWidth }),
        ...(style.heads && { startHead: style.heads.start, endHead: style.heads.end }),
      };
    case "rect":
    case "ellipse": {
      const color = style.color ?? shape.stroke;
      const filled = style.filled ?? shape.fill !== undefined;
      return {
        ...(style.color && { stroke: style.color }),
        ...(size && { strokeWidth: size.strokeWidth }),
        // Explicitly undefined, so the update removes the fill.
        ...((style.color || style.filled !== undefined) && { fill: filled ? color : undefined }),
      };
    }
    case "text":
      return {
        ...(style.color && { fill: style.color }),
        ...(size && { fontSize: size.fontSize }),
      };
    case "highlight":
      return style.color ? { fill: style.color } : {};
    case "blur":
      return size ? { pixelSize: size.pixelSize } : {};
    case "image":
      return {};
  }
}
