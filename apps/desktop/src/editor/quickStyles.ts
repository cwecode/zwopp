// Quick styles: named tool styles the user saves, applies with one click or
// the number keys, and shares as a JSON file. They live in the settings
// (`settings.editor`) next to each tool's last-used style.
import { newId, type ArrowHead, type FontFamily } from "./document";
import { STAMPS, type StampKind } from "./stamps";
import { DEFAULT_STYLES, FONTS, MAX_STEP_NUMBER, SIZES, TOOLS, type Tool, type ToolStyle } from "./tools";

export interface QuickStyle {
  id: string;
  name: string;
  tool: Tool;
  style: ToolStyle;
}

/** What the editor keeps in `settings.editor`. */
export interface EditorSettings {
  /** Each tool's last-used style, the default for its next shape. */
  toolStyles: Partial<Record<Tool, ToolStyle>>;
  quickStyles: QuickStyle[];
}

/** Marks a shared quick-styles file. */
const FILE_FORMAT = "zwopp-quick-styles";
const FILE_VERSION = 1;
/** Number keys apply the first quick styles of the current tool. */
export const QUICK_STYLE_KEYS = 9;

const HEAD_KINDS: ArrowHead[] = ["none", "filled", "open"];
const isTool = (value: unknown): value is Tool =>
  TOOLS.some((tool) => tool.id === value) && value !== "select";
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A style as stored or shared, checked field by field: anything malformed
 * falls back to the tool's default, so a broken file cannot break the editor.
 */
export function sanitizeStyle(tool: Tool, raw: unknown): ToolStyle {
  const base = DEFAULT_STYLES[tool];
  if (!isObject(raw)) return base;
  const style: ToolStyle = { ...base };
  if (typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color)) style.color = raw.color.toLowerCase();
  if (Number.isInteger(raw.size) && (raw.size as number) >= 0 && (raw.size as number) < SIZES.length) {
    style.size = raw.size as number;
  }
  if (base.heads && isObject(raw.heads)) {
    const { start, end } = raw.heads;
    if (HEAD_KINDS.includes(start as ArrowHead) && HEAD_KINDS.includes(end as ArrowHead)) {
      style.heads = { start: start as ArrowHead, end: end as ArrowHead };
    }
  }
  for (const flag of ["filled", "background", "round"] as const) {
    if (base[flag] !== undefined && typeof raw[flag] === "boolean") style[flag] = raw[flag];
  }
  if (base.font && typeof raw.font === "string" && raw.font in FONTS) style.font = raw.font as FontFamily;
  if (base.emoji && typeof raw.emoji === "string" && raw.emoji && [...raw.emoji].length <= 8) style.emoji = raw.emoji;
  if (base.stamp && STAMPS.includes(raw.stamp as StampKind)) style.stamp = raw.stamp as StampKind;
  const number = raw.number as number;
  if (tool === "step" && Number.isInteger(number) && number >= 1 && number <= MAX_STEP_NUMBER) style.number = number;
  return style;
}

function readQuickStyle(raw: unknown, id: string): QuickStyle | null {
  if (!isObject(raw) || !isTool(raw.tool)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "";
  return { id, name, tool: raw.tool, style: sanitizeStyle(raw.tool, raw.style) };
}

/** The editor's part of the settings, checked like a shared file. */
export function readEditorSettings(raw: unknown): EditorSettings {
  const data = isObject(raw) ? raw : {};
  const toolStyles: EditorSettings["toolStyles"] = {};
  if (isObject(data.toolStyles)) {
    for (const [tool, style] of Object.entries(data.toolStyles)) {
      if (isTool(tool)) toolStyles[tool] = sanitizeStyle(tool, style);
    }
  }
  const quickStyles = Array.isArray(data.quickStyles)
    ? data.quickStyles.flatMap((entry) => {
        const id = isObject(entry) && typeof entry.id === "string" ? entry.id : newId();
        return readQuickStyle(entry, id) ?? [];
      })
    : [];
  return { toolStyles, quickStyles };
}

/** Every tool's style: the last-used one, else the default. */
export function initialStyles(saved: EditorSettings["toolStyles"]): Record<Tool, ToolStyle> {
  const styles = { ...DEFAULT_STYLES };
  for (const tool of Object.keys(saved) as Tool[]) styles[tool] = { ...DEFAULT_STYLES[tool], ...saved[tool] };
  return styles;
}

/** `style` with only the fields `tool` uses, e.g. to save it as a quick style. */
export function styleFor(tool: Tool, style: ToolStyle): ToolStyle {
  const fields = Object.keys(DEFAULT_STYLES[tool]) as (keyof ToolStyle)[];
  return Object.fromEntries(
    fields.map((field) => [field, style[field] ?? DEFAULT_STYLES[tool][field]]),
  ) as unknown as ToolStyle;
}

/** Whether two styles look the same for `tool`. */
export const sameStyle = (tool: Tool, a: ToolStyle, b: ToolStyle) =>
  JSON.stringify(styleFor(tool, a)) === JSON.stringify(styleFor(tool, b));

/** The quick styles for one tool, in their saved order. */
export const quickStylesFor = (styles: QuickStyle[], tool: Tool) => styles.filter((s) => s.tool === tool);

/** A file to share quick styles with others. */
export function serializeQuickStyles(styles: QuickStyle[]): string {
  return JSON.stringify(
    {
      format: FILE_FORMAT,
      version: FILE_VERSION,
      styles: styles.map(({ name, tool, style }) => ({ name, tool, style })),
    },
    null,
    2,
  );
}

/** The quick styles in a shared file, with new ids; throws if it is no such file. */
export function parseQuickStyles(text: string): QuickStyle[] {
  const data: unknown = JSON.parse(text);
  if (!isObject(data) || data.format !== FILE_FORMAT || !Array.isArray(data.styles)) {
    throw new Error("not a quick-styles file");
  }
  return data.styles.flatMap((entry) => readQuickStyle(entry, newId()) ?? []);
}
