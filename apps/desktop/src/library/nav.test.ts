import { describe, expect, it } from "vitest";
import { groupYears, queryFor, recentSince } from "./nav";

const now = new Date(2026, 9, 29, 15, 30);

describe("queryFor", () => {
  it("selects everything, favorites or an application", () => {
    expect(queryFor({ kind: "all" }, "login", now)).toEqual({ search: "login", favoritesOnly: false });
    expect(queryFor({ kind: "favorites" }, undefined, now).favoritesOnly).toBe(true);
    expect(queryFor({ kind: "app", app: "Excel" }, undefined, now).app).toBe("Excel");
  });

  it("covers a year or a month in local time", () => {
    const year = queryFor({ kind: "year", year: 2025 }, undefined, now);
    expect(new Date(year.from!)).toEqual(new Date(2025, 0, 1));
    expect(new Date(year.until!)).toEqual(new Date(2026, 0, 1));
    const december = queryFor({ kind: "month", year: 2025, month: 12 }, undefined, now);
    expect(new Date(december.from!)).toEqual(new Date(2025, 11, 1));
    expect(new Date(december.until!)).toEqual(new Date(2026, 0, 1));
  });

  it("starts the recent range at midnight, six days before today", () => {
    expect(recentSince(now)).toEqual(new Date(2026, 9, 23));
    expect(recentSince(new Date(2026, 0, 2, 8))).toEqual(new Date(2025, 11, 27));
    expect(new Date(queryFor({ kind: "recent" }, undefined, now).from!)).toEqual(new Date(2026, 9, 23));
  });
});

describe("groupYears", () => {
  it("sums months into years, newest first", () => {
    const years = groupYears([
      { year: 2025, month: 3, count: 2 },
      { year: 2026, month: 1, count: 1 },
      { year: 2025, month: 11, count: 4 },
    ]);
    expect(years).toEqual([
      { year: 2026, count: 1, months: [{ month: 1, count: 1 }] },
      {
        year: 2025,
        count: 6,
        months: [
          { month: 11, count: 4 },
          { month: 3, count: 2 },
        ],
      },
    ]);
  });
});
