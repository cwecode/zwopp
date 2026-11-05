import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "../api";
import { useT } from "../i18n";

/**
 * Offers a newer Zwopp at the top of the library. Nothing happens without a
 * click; "Later" hides it until the next start or the next version.
 */
export function UpdateBanner() {
  const t = useT();
  const [update, setUpdate] = useState<api.AvailableUpdate | null>(null);
  const [later, setLater] = useState<string>();
  const [progress, setProgress] = useState<api.UpdateProgress>();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .updateStatus()
      .then((status) => setUpdate(status.available))
      .catch(() => {});
    const unlisten = Promise.all([
      listen<api.AvailableUpdate>("update:available", (e) => setUpdate(e.payload)),
      listen<api.UpdateProgress>("update:progress", (e) => setProgress(e.payload)),
      listen<string>("update:failed", (e) => {
        setInstalling(false);
        setError(e.payload);
      }),
    ]);
    return () => void unlisten.then((fns) => fns.forEach((fn) => fn()));
  }, []);

  if (!update || later === update.version) return null;

  const install = () => {
    setInstalling(true);
    setError(undefined);
    api.installUpdate().catch((e) => {
      setInstalling(false);
      setError(String(e));
    });
  };

  const percent =
    progress?.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : undefined;

  return (
    <div className="update-banner" role="status">
      <span className="update-dot" aria-hidden="true" />
      <span className="update-text">
        {installing
          ? percent === undefined
            ? t.update.downloading
            : t.update.downloadingPercent(percent)
          : error
            ? t.update.failed(error)
            : t.update.available(update.version)}
      </span>
      {update.notes && !installing && (
        <details className="update-notes">
          <summary>{t.update.whatsNew}</summary>
          <pre>{update.notes}</pre>
        </details>
      )}
      <span className="spacer" />
      {!installing && (
        <>
          <button className="primary" onClick={install}>
            {t.update.install}
          </button>
          <button onClick={() => setLater(update.version)}>{t.update.later}</button>
        </>
      )}
    </div>
  );
}
