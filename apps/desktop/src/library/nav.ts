// The library's navigation: which part of the library is shown, and the
// query that selects it. Dates are in local time, like the counts the core
// groups by month (`Library::overview`).
import type { ListQuery, Overview } from "../api";

/** "Recent" covers today and the days before it, this many in all. */
export const RECENT_DAYS = 7;

export type NavSelection =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "recent" }
  | { kind: "year"; year: number }
  | { kind: "month"; year: number; month: number }
  | { kind: "app"; app: string };

export const ALL: NavSelection = { kind: "all" };

/** Local midnight at the start of the recent range. */
export function recentSince(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (RECENT_DAYS - 1));
}

/** The list query for a selection, combined with the search text. */
export function queryFor(selection: NavSelection, search: string | undefined, now: Date): ListQuery {
  const query: ListQuery = { search, favoritesOnly: false };
  switch (selection.kind) {
    case "favorites":
      query.favoritesOnly = true;
      break;
    case "recent":
      query.from = recentSince(now).toISOString();
      break;
    case "year":
      query.from = new Date(selection.year, 0, 1).toISOString();
      query.until = new Date(selection.year + 1, 0, 1).toISOString();
      break;
    case "month":
      // Month is 1–12; Date wants 0–11 and rolls December over into January.
      query.from = new Date(selection.year, selection.month - 1, 1).toISOString();
      query.until = new Date(selection.year, selection.month, 1).toISOString();
      break;
    case "app":
      query.app = selection.app;
      break;
  }
  return query;
}

export const sameSelection = (a: NavSelection, b: NavSelection) => JSON.stringify(a) === JSON.stringify(b);

export interface YearGroup {
  year: number;
  count: number;
  /** Newest first. */
  months: { month: number; count: number }[];
}

/** The overview's months grouped by year, newest first. */
export function groupYears(months: Overview["months"]): YearGroup[] {
  const years: YearGroup[] = [];
  for (const { year, month, count } of months) {
    let group = years.find((y) => y.year === year);
    if (!group) {
      group = { year, count: 0, months: [] };
      years.push(group);
    }
    group.count += count;
    group.months.push({ month, count });
  }
  years.sort((a, b) => b.year - a.year);
  for (const group of years) group.months.sort((a, b) => b.month - a.month);
  return years;
}
