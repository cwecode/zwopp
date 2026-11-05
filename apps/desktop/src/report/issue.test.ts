import { describe, expect, it } from "vitest";
import type { ReportInfo } from "../api";
import { details, issueUrl } from "./issue";

const info: ReportInfo = {
  version: "1.3.0",
  os: "Windows 11",
  osDetails: "Windows 11 Pro 10.0.26200 (x86_64), 1 monitor(s): 2560×1440 at 100 %",
  log: "[WARN] capture failed: no monitor",
};

describe("issueUrl", () => {
  it("fills in the bug form", () => {
    const url = new URL(issueUrl("bug", info, true));
    expect(url.origin + url.pathname).toBe("https://github.com/cwecode/zwopp/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("version")).toBe("1.3.0");
    expect(url.searchParams.get("os")).toBe("Windows 11");
    expect(url.searchParams.get("os-details")).toContain("2560×1440");
    expect(url.searchParams.get("logs")).toBe(info.log);
  });

  it("leaves the log out when not wanted", () => {
    expect(new URL(issueUrl("bug", info, false)).searchParams.has("logs")).toBe(false);
  });

  it("only adds the version to an idea", () => {
    const url = new URL(issueUrl("idea", info, true));
    expect(url.searchParams.get("template")).toBe("feature_request.yml");
    expect([...url.searchParams.keys()]).toEqual(["template", "version"]);
  });
});

describe("details", () => {
  it("lists version, system and log", () => {
    expect(details(info, true)).toBe(`Zwopp 1.3.0\n${info.osDetails}\n\nLog:\n${info.log}`);
    expect(details(info, false)).not.toContain("Log:");
  });
});
