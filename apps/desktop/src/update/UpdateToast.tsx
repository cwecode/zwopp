import { useT } from "../i18n";
import { dismissUpdate, installUpdate, useUpdate } from "./store";

/**
 * A small card in the bottom right corner when a newer Zwopp is on offer.
 * It never installs by itself; closing it hides it until the next start
 * (the dot on the settings button stays).
 */
export function UpdateToast() {
  const t = useT();
  const update = useUpdate();
  const offer = update.available;
  if (!offer || (update.dismissed === offer.version && !update.installing)) return null;

  return (
    <aside className="update-toast" role="status" aria-label={t.update.title}>
      <div className="update-toast-head">
        <span className="update-dot" aria-hidden="true" />
        <strong>{t.update.title}</strong>
        <span className="spacer" />
        {!update.installing && (
          <button className="update-toast-close" onClick={dismissUpdate} title={t.update.dismiss} aria-label={t.update.dismiss}>
            ✕
          </button>
        )}
      </div>
      {update.installing ? (
        <>
          <p>{update.percent === undefined ? t.update.downloading : t.update.downloadingPercent(update.percent)}</p>
          <div className="update-progress" aria-hidden="true">
            <div style={{ width: `${update.percent ?? 0}%` }} />
          </div>
        </>
      ) : (
        <>
          <p>{update.error ? t.update.failed(update.error) : t.update.ready(offer.version)}</p>
          {offer.notes && (
            <details className="update-notes">
              <summary>{t.update.whatsNew}</summary>
              <pre>{offer.notes}</pre>
            </details>
          )}
          <div className="update-toast-actions">
            <button className="primary" onClick={installUpdate}>
              {t.update.installRestart}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
