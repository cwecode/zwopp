// Links to Zwopp's issue forms on GitHub, filled in with what the app knows.
// GitHub fills form fields from query parameters named like the field ids in
// .github/ISSUE_TEMPLATE/*.yml.
import type { ReportInfo } from "../api";

export const ISSUES = "https://github.com/cwecode/zwopp/issues/new";

export type IssueKind = "bug" | "idea";

/** The text shared by both forms and by "Copy details". */
export function details(info: ReportInfo, withLog: boolean): string {
  const lines = [`Zwopp ${info.version}`, info.osDetails];
  if (withLog && info.log) lines.push("", "Log:", info.log);
  return lines.join("\n");
}

/** The form for `kind`, filled in with version, system and (if wanted) the log. */
export function issueUrl(kind: IssueKind, info: ReportInfo, withLog: boolean): string {
  const params = new URLSearchParams({
    template: kind === "bug" ? "bug_report.yml" : "feature_request.yml",
    version: info.version,
  });
  if (kind === "bug") {
    params.set("os", info.os);
    params.set("os-details", info.osDetails);
    if (withLog && info.log) params.set("logs", info.log);
  }
  return `${ISSUES}?${params}`;
}
