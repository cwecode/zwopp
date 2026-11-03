// Leading new users in gently: the tool rail shows one tool per family, and
// what is behind it comes up once it is needed. Nothing is ever locked; only
// what is shown changes. The state lives in `settings.editor.guide`.
import { FAMILIES, TOOLS, type Family, type Tool } from "./tools";

export interface Guide {
  /** How often each tool was picked. */
  used: Partial<Record<Tool, number>>;
  /** The tool each family slot shows: the one picked last. */
  front: Partial<Record<Family, Tool>>;
  /** Tips the user has seen (and closed). */
  seenTips: string[];
  /** Families whose menu was opened since its tools were pointed out. */
  openedFamilies: Family[];
  /** Every tool in the rail on its own instead of one per family. */
  allTools: boolean;
  /** The layers panel is open. */
  showLayers: boolean;
}

export const NEW_GUIDE: Guide = {
  used: {},
  front: {},
  seenTips: [],
  openedFamilies: [],
  allTools: false,
  showLayers: false,
};

/** A family slot with this many picks points out the family's other tools. */
export const DISCOVER_AFTER = 5;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isTool = (value: unknown): value is Tool => TOOLS.some((t) => t.id === value);
const isFamily = (value: unknown): value is Family => FAMILIES.some((f) => f.id === value);

/** The guide state from the editor settings, checked field by field. */
export function readGuide(editor: unknown): Guide {
  const raw = isObject(editor) && isObject(editor.guide) ? editor.guide : {};
  const used: Guide["used"] = {};
  if (isObject(raw.used)) {
    for (const [tool, count] of Object.entries(raw.used)) {
      if (isTool(tool) && Number.isInteger(count) && (count as number) > 0) used[tool] = count as number;
    }
  }
  const front: Guide["front"] = {};
  if (isObject(raw.front)) {
    for (const [family, tool] of Object.entries(raw.front)) {
      if (isFamily(family) && isTool(tool) && FAMILIES.find((f) => f.id === family)!.tools.includes(tool)) {
        front[family] = tool;
      }
    }
  }
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  return {
    used,
    front,
    seenTips: strings(raw.seenTips),
    openedFamilies: strings(raw.openedFamilies).filter(isFamily),
    allTools: raw.allTools === true,
    showLayers: raw.showLayers === true,
  };
}

/** The guide after picking `tool`: counted, and in front of its family. */
export function pickTool(guide: Guide, tool: Tool, family: Family): Guide {
  return {
    ...guide,
    used: { ...guide.used, [tool]: (guide.used[tool] ?? 0) + 1 },
    front: { ...guide.front, [family]: tool },
  };
}

/** The tool a family slot shows. */
export const frontTool = (guide: Guide, family: Family): Tool =>
  guide.front[family] ?? FAMILIES.find((f) => f.id === family)!.tools[0];

/**
 * Whether a family slot points out its other tools: it was used a lot, some
 * of its tools never, and its menu was not opened since.
 */
export function hasNews(guide: Guide, family: Family): boolean {
  const { tools } = FAMILIES.find((f) => f.id === family)!;
  if (tools.length < 2 || guide.openedFamilies.includes(family)) return false;
  const picks = tools.reduce((sum, tool) => sum + (guide.used[tool] ?? 0), 0);
  return picks >= DISCOVER_AFTER && tools.some((tool) => !guide.used[tool]);
}

/** A tip, shown once when it becomes useful. Texts are in the translations (`tips`). */
export type TipId = "families" | "stepRepeat" | "wand" | "quickStyles" | "shortcuts";

/** What the tips look at. */
export interface TipContext {
  tool: Tool;
  /** Step badges in the open document. */
  steps: number;
  /** Style changes in this editor session. */
  styleChanges: number;
}

/** The tip to show now, if any: the first useful one not seen yet. */
export function nextTip(guide: Guide, context: TipContext): TipId | null {
  const total = Object.values(guide.used).reduce((sum, n) => sum + (n ?? 0), 0);
  const candidates: [TipId, boolean][] = [
    ["families", true],
    ["stepRepeat", context.tool === "step" && context.steps >= 2],
    ["wand", context.tool === "blur" && (guide.used.blur ?? 0) >= 2],
    ["quickStyles", context.styleChanges >= 4],
    ["shortcuts", total >= 15],
  ];
  return candidates.find(([id, useful]) => useful && !guide.seenTips.includes(id))?.[0] ?? null;
}
