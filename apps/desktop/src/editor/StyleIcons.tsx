import type { ArrowHead } from "./document";
import { contrastColor } from "./document";
import { FONTS, SIZES, TOOLS, type ArrowHeads, type Tool, type ToolStyle } from "./tools";

/** A tiny line with the given heads, for the line-ends buttons. */
export function HeadsIcon({ start, end }: ArrowHeads) {
  const head = (kind: ArrowHead, tip: number, dir: 1 | -1) =>
    kind === "none" ? null : (
      <path
        d={`M ${tip - dir * 7} 3 L ${tip} 8 L ${tip - dir * 7} 13${kind === "filled" ? " Z" : ""}`}
        fill={kind === "filled" ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    );
  return (
    <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden>
      <line x1="2" y1="8" x2="24" y2="8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {head(start, 2, -1)}
      {head(end, 24, 1)}
    </svg>
  );
}

/** A small picture of a tool style, for quick-style buttons and lists. */
export function StyleSwatch({ tool, style }: { tool: Tool; style: ToolStyle }) {
  const size = SIZES[style.size]?.label;
  let icon;
  if (tool === "emoji") icon = style.emoji;
  else if (style.heads) icon = <HeadsIcon {...style.heads} />;
  else if (tool === "text" || tool === "callout") {
    const boxed = tool === "callout" || style.background;
    icon = (
      <span
        className="swatch-text"
        style={{
          fontFamily: FONTS[style.font ?? "sans"],
          ...(boxed ? { background: style.color, color: contrastColor(style.color) } : {}),
        }}
      >
        Ab
      </span>
    );
  } else if (tool === "rect") icon = style.filled ? "■" : "□";
  else if (tool === "ellipse") icon = style.filled ? "●" : "○";
  else if (tool === "magnify") icon = style.round ? "◯" : "▢";
  else icon = TOOLS.find((entry) => entry.id === tool)?.icon;
  return (
    <span className="style-swatch" style={{ color: tool === "blur" || tool === "emoji" ? undefined : style.color }}>
      {icon}
      {tool !== "highlight" && <small>{size}</small>}
    </span>
  );
}
