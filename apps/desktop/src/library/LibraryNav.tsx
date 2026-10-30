import { useMemo, useState, type ReactNode } from "react";
import type { Overview } from "../api";
import { useT } from "../i18n";
import { AppIcon } from "./AppIcon";
import { groupYears, sameSelection, type NavSelection } from "./nav";

/**
 * The library's sidebar: search, then everything / favorites / recent, the
 * years with their months, and the applications screenshots came from.
 */
export function LibraryNav({
  overview,
  selection,
  onSelect,
  search,
  onSearch,
}: {
  overview: Overview | undefined;
  selection: NavSelection;
  onSelect(selection: NavSelection): void;
  search: string;
  onSearch(search: string): void;
}) {
  const t = useT();
  const years = useMemo(() => groupYears(overview?.months ?? []), [overview]);
  // The current year starts open; everything else closed.
  const [openYears, setOpenYears] = useState(() => new Set([new Date().getFullYear()]));
  const [appsOpen, setAppsOpen] = useState(true);
  const monthName = useMemo(() => {
    const format = new Intl.DateTimeFormat(t.locale, { month: "long" });
    return (month: number) => format.format(new Date(2000, month - 1, 1));
  }, [t.locale]);
  const number = (n: number | undefined) => (n === undefined ? "" : n.toLocaleString(t.locale));

  const toggleYear = (year: number) =>
    setOpenYears((open) => {
      const next = new Set(open);
      if (!next.delete(year)) next.add(year);
      return next;
    });

  const entry = (target: NavSelection, icon: ReactNode, label: string, count: number | undefined, depth = 0) => (
    <button
      className={sameSelection(target, selection) ? "nav-entry active" : "nav-entry"}
      style={{ paddingLeft: 8 + depth * 16 }}
      aria-current={sameSelection(target, selection) || undefined}
      onClick={() => onSelect(target)}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      <span className="nav-count">{number(count)}</span>
    </button>
  );

  const toggle = (open: boolean, label: string, onToggle: () => void) => (
    <button
      className="nav-toggle"
      aria-expanded={open}
      aria-label={open ? t.library.nav.collapse(label) : t.library.nav.expand(label)}
      onClick={onToggle}
    >
      {open ? "▾" : "▸"}
    </button>
  );

  return (
    <nav className="library-nav" aria-label={t.library.nav.title}>
      <input
        type="search"
        className="search"
        placeholder={t.library.search}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <div className="nav-tree">
        {entry({ kind: "all" }, "▦", t.library.nav.all, overview?.total)}
        {entry({ kind: "favorites" }, "★", t.library.favorites, overview?.favorites)}
        {entry({ kind: "recent" }, "◷", t.library.nav.recent, overview?.recent)}

        {years.length > 0 && <div className="nav-heading">{t.library.nav.dates}</div>}
        {years.map((group) => {
          const open = openYears.has(group.year);
          return (
            <div key={group.year} className="nav-group">
              <div className="nav-row">
                {toggle(open, String(group.year), () => toggleYear(group.year))}
                {entry({ kind: "year", year: group.year }, "▤", String(group.year), group.count)}
              </div>
              {open &&
                group.months.map(({ month, count }) => (
                  <div key={month} className="nav-row">
                    {entry({ kind: "month", year: group.year, month }, "", monthName(month), count, 1)}
                  </div>
                ))}
            </div>
          );
        })}

        {overview && overview.apps.length > 0 && (
          <div className="nav-group">
            <div className="nav-row nav-heading-row">
              {toggle(appsOpen, t.library.nav.apps, () => setAppsOpen((o) => !o))}
              <span className="nav-heading">{t.library.nav.apps}</span>
            </div>
            {appsOpen &&
              overview.apps.map(({ app, count, icon }) => (
                <div key={app} className="nav-row">
                  {entry({ kind: "app", app }, <AppIcon app={app} icon={icon} />, app, count, 1)}
                </div>
              ))}
          </div>
        )}
      </div>
    </nav>
  );
}
