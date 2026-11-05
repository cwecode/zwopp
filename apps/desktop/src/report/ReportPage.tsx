import { useEffect, useState } from "react";
import * as api from "../api";
import { useT } from "../i18n";
import { details, issueUrl, type IssueKind } from "./issue";

/**
 * "Report a problem": shows what would go into an issue, then opens GitHub's
 * form filled in with it. Nothing is sent from Zwopp itself (ADR 0011).
 */
export function ReportPage({ onClose }: { onClose(): void }) {
  const t = useT();
  const [info, setInfo] = useState<api.ReportInfo>();
  const [withLog, setWithLog] = useState(true);
  const [message, setMessage] = useState<string>();

  const report = (e: unknown) => setMessage(String(e));
  useEffect(() => {
    api.reportInfo().then(setInfo).catch(report);
  }, []);

  const open = (kind: IssueKind) => info && api.openIssue(issueUrl(kind, info, withLog)).catch(report);

  return (
    <div className="settings">
      <header className="toolbar">
        <button onClick={onClose}>← {t.settings.back}</button>
        <h1>{t.report.title}</h1>
      </header>

      {message && (
        <div className="notice" role="status">
          {message}
          <button onClick={() => setMessage(undefined)}>{t.ok}</button>
        </div>
      )}

      <main className="settings-body">
        <section>
          <h2>{t.report.howTitle}</h2>
          <p className="hint">{t.report.how}</p>
          <div className="row">
            <button className="primary" disabled={!info} onClick={() => open("bug")}>
              {t.report.bug}
            </button>
            <button disabled={!info} onClick={() => open("idea")}>
              {t.report.idea}
            </button>
          </div>
        </section>

        <section>
          <h2>{t.report.includedTitle}</h2>
          <p className="hint">{t.report.included}</p>
          <pre className="report-details">{info ? details(info, false) : "…"}</pre>
          <label className="setting-value checks">
            <input type="checkbox" checked={withLog} onChange={(e) => setWithLog(e.target.checked)} />
            {t.report.withLog}
          </label>
          {withLog && <pre className="report-details report-log">{info?.log || t.report.noLog}</pre>}
          <div className="row">
            <button
              disabled={!info}
              onClick={() =>
                info &&
                navigator.clipboard
                  .writeText(details(info, withLog))
                  .then(() => setMessage(t.report.copied))
                  .catch(report)
              }
            >
              {t.report.copy}
            </button>
            <button onClick={() => api.openLogFolder().catch(report)}>{t.report.logFolder}</button>
          </div>
        </section>
      </main>
    </div>
  );
}
