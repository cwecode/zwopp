import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { frontTool, hasNews, type Guide } from "./guide";
import { FAMILIES, TOOLS, type Family, type Tool } from "./tools";

const iconOf = (tool: Tool) => TOOLS.find((t) => t.id === tool)!.icon;
const keyOf = (tool: Tool) => TOOLS.find((t) => t.id === tool)!.key.toUpperCase();

/**
 * The tools down the left edge. Each family takes one slot showing the tool
 * picked last; its other tools are behind the corner mark (or a right-click).
 * With `guide.allTools`, every tool has a slot of its own.
 */
export function ToolRail({
  tool,
  guide,
  onPick,
  onOpenFamily,
}: {
  tool: Tool;
  guide: Guide;
  onPick(tool: Tool): void;
  onOpenFamily(family: Family): void;
}) {
  const t = useT();
  const [open, setOpen] = useState<Family | null>(null);
  const root = useRef<HTMLElement>(null);

  // A click elsewhere or Esc closes the menu.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const toggle = (family: Family) => {
    if (open === family) return setOpen(null);
    setOpen(family);
    onOpenFamily(family);
  };

  const slot = (shown: Tool, label: string, family?: Family) => {
    const members = family ? FAMILIES.find((f) => f.id === family)!.tools : [shown];
    const active = members.includes(tool);
    return (
      <div key={family ?? shown} className="rail-slot">
        <button
          className={active ? "rail-tool active" : "rail-tool"}
          aria-pressed={active}
          title={`${t.tools[shown]} (${keyOf(shown)})`}
          onClick={() => onPick(shown)}
          onContextMenu={(e) => {
            if (!family || members.length < 2) return;
            e.preventDefault();
            toggle(family);
          }}
        >
          <span className="rail-icon" aria-hidden>
            {iconOf(shown)}
          </span>
          <span className="rail-label">{label}</span>
        </button>
        {family && members.length > 1 && (
          <button
            className="rail-more"
            aria-label={t.editor.moreTools(label)}
            title={t.editor.moreTools(label)}
            aria-expanded={open === family}
            onClick={() => toggle(family)}
          >
            {hasNews(guide, family) && <span className="rail-news" aria-hidden />}
          </button>
        )}
        {family && open === family && (
          <div className="rail-menu" role="menu" aria-label={label}>
            {members.map((member) => (
              <button
                key={member}
                role="menuitemradio"
                aria-checked={tool === member}
                className={tool === member ? "active" : undefined}
                onClick={() => {
                  onPick(member);
                  setOpen(null);
                }}
              >
                <span className="rail-icon" aria-hidden>
                  {iconOf(member)}
                </span>
                <span>{t.tools[member]}</span>
                {!guide.used[member] && <span className="rail-new">{t.editor.newTool}</span>}
                <kbd>{keyOf(member)}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav className="tool-rail" ref={root} aria-label={t.editor.tools}>
      {guide.allTools
        ? FAMILIES.map((family) => (
            <div key={family.id} className="rail-family">
              {family.tools.map((member) => slot(member, t.tools[member]))}
            </div>
          ))
        : FAMILIES.map((family) => slot(frontTool(guide, family.id), t.families[family.id], family.id))}
    </nav>
  );
}
