import type { ArrowHead } from "./document";
import { contrastColor } from "./document";
import {
  BODY,
  DIVIDERS,
  STAMP_BOX,
  STAMP_DRAWINGS,
  STAMP_LINE,
  STAMP_OUTLINE,
  WHEEL,
  type StampKind,
} from "./stamps";
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

/** A mouse stamp as SVG, drawn from the same paths as on the canvas. */
export function StampIcon({ kind, color, height = 20 }: { kind: StampKind; color: string; height?: number }) {
  const drawing = STAMP_DRAWINGS[kind];
  const line = { stroke: STAMP_OUTLINE, strokeWidth: STAMP_LINE, fill: "none" };
  return (
    <svg
      height={height}
      width={(height * STAMP_BOX.width) / STAMP_BOX.height}
      viewBox={`0 0 ${STAMP_BOX.width} ${STAMP_BOX.height}`}
      aria-hidden
    >
      <path d={BODY} fill="#ffffff" />
      {drawing.fills.map((d) => (
        <path key={d} d={d} fill={color} />
      ))}
      <path d={DIVIDERS} {...line} />
      <path d={WHEEL} {...line} />
      <path d={BODY} {...line} strokeLinejoin="round" />
      {drawing.marks && (
        <path
          d={drawing.marks}
          fill="none"
          stroke={color}
          strokeWidth={STAMP_LINE * 1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {drawing.label && (
        <text
          x={STAMP_BOX.width / 2}
          y={22}
          fill={color}
          fontSize="9"
          fontWeight="bold"
          fontFamily={FONTS.sans}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {drawing.label}
        </text>
      )}
    </svg>
  );
}

/** A small picture of a tool style, for quick-style buttons and lists. */
export function StyleSwatch({ tool, style }: { tool: Tool; style: ToolStyle }) {
  const size = SIZES[style.size]?.label;
  let icon;
  if (tool === "emoji") icon = style.emoji;
  else if (tool === "stamp") icon = <StampIcon kind={style.stamp ?? "left"} color={style.color} height={16} />;
  else if (tool === "step" && style.number !== undefined) icon = style.number;
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
