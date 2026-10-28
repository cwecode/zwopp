import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import { formatAccelerator, useT, type Language } from "../i18n";
import { parseQuickStyles, readEditorSettings, serializeQuickStyles, type QuickStyle } from "../editor/quickStyles";
import { StyleSwatch } from "../editor/StyleIcons";
import { acceleratorFromEvent } from "./accelerator";
import { updateEditorSettings, updateSettings, useSettings } from "./store";

/** The built-in hotkeys, tried in this order (`CAPTURE_SHORTCUTS` in settings.rs). */
const DEFAULT_HOTKEYS = ["CommandOrControl+Shift+X", "CommandOrControl+Alt+X", "CommandOrControl+Shift+2"];
const LANGUAGES: Language[] = ["de", "en"];

export function SettingsPage({ onClose }: { onClose(): void }) {
  const t = useT();
  const settings = useSettings();
  const [info, setInfo] = useState<api.SettingsInfo>();
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string>();
  const quickStyles = useMemo(() => readEditorSettings(settings.editor).quickStyles, [settings.editor]);

  const report = (e: unknown) => setMessage(String(e));
  useEffect(() => {
    api.getSettings().then(setInfo).catch(report);
  }, []);

  const change = (patch: Partial<api.Settings>) => updateSettings(patch).then(setInfo).catch(report);

  // While recording, the next valid key combination becomes the hotkey.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      const accelerator = acceleratorFromEvent(e);
      if (!accelerator) return;
      setRecording(false);
      updateSettings({ captureHotkey: accelerator })
        .then((next) => {
          setInfo(next);
          setMessage(undefined);
        })
        .catch(() => setMessage(t.settings.hotkeyTaken(formatAccelerator(t, accelerator))));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, t]);

  const setQuickStyles = (next: QuickStyle[]) => updateEditorSettings({ quickStyles: next }).catch(report);

  const exportQuickStyles = async () => {
    try {
      const path = await api.saveTextFile(
        t.settings.exportDialog,
        t.settings.exportFileName,
        serializeQuickStyles(quickStyles),
      );
      if (path) setMessage(t.settings.exported(path));
    } catch (e) {
      report(e);
    }
  };

  const importQuickStyles = async () => {
    let text;
    try {
      text = await api.openTextFile(t.settings.importDialog);
    } catch (e) {
      return report(e);
    }
    if (text === null) return;
    let imported;
    try {
      imported = parseQuickStyles(text);
    } catch {
      return setMessage(t.settings.importFailed);
    }
    await setQuickStyles([...quickStyles, ...imported]);
    setMessage(t.settings.imported(imported.length));
  };

  const shortcut = info?.captureShortcut;
  const wanted = settings.captureHotkey;
  const libraryTarget = settings.libraryDir ?? info?.defaultLibraryDir;
  const restartPending = info && !info.libraryDirFromEnv && libraryTarget !== info.libraryDir;

  return (
    <div className="settings">
      <header className="toolbar">
        <button onClick={onClose}>← {t.settings.back}</button>
        <h1>{t.settings.title}</h1>
      </header>

      {message && (
        <div className="notice" role="status">
          {message}
          <button onClick={() => setMessage(undefined)}>{t.ok}</button>
        </div>
      )}

      <main className="settings-body">
        <section>
          <h2>{t.settings.general}</h2>
          <label className="setting">
            <span>{t.settings.language}</span>
            <select
              value={settings.language ?? ""}
              onChange={(e) => change({ language: e.target.value || null })}
            >
              <option value="">{t.settings.systemLanguage}</option>
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t.settings.languages[language]}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section>
          <h2>{t.settings.capture}</h2>
          <div className="setting">
            <span>{t.settings.hotkey}</span>
            <div className="setting-value">
              {recording ? (
                <kbd className="recording">{t.settings.hotkeyRecording}</kbd>
              ) : shortcut ? (
                <kbd>{formatAccelerator(t, shortcut)}</kbd>
              ) : (
                <em>{t.settings.hotkeyNone}</em>
              )}
              <button onClick={() => setRecording((r) => !r)} aria-pressed={recording}>
                {t.settings.hotkeyChange}
              </button>
              <button
                disabled={wanted === null}
                title={t.settings.hotkeyDefaultTitle(DEFAULT_HOTKEYS.map((h) => formatAccelerator(t, h)).join(", "))}
                onClick={() => change({ captureHotkey: null })}
              >
                {t.settings.hotkeyDefault}
              </button>
            </div>
            <p className="hint">
              {wanted && shortcut !== wanted
                ? t.settings.hotkeyFallback(formatAccelerator(t, wanted))
                : t.settings.hotkeyHint}
            </p>
          </div>
          <div className="setting">
            <span>{t.settings.afterCapture}</span>
            <div className="setting-value checks">
              <label>
                <input
                  type="checkbox"
                  checked={settings.copyAfterCapture}
                  onChange={(e) => change({ copyAfterCapture: e.target.checked })}
                />
                {t.settings.copyAfterCapture}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.editAfterCapture}
                  onChange={(e) => change({ editAfterCapture: e.target.checked })}
                />
                {t.settings.editAfterCapture}
              </label>
            </div>
          </div>
        </section>

        <section>
          <h2>{t.settings.library}</h2>
          <div className="setting">
            <span>{t.settings.libraryFolder}</span>
            <div className="setting-value">
              <code className="path">{libraryTarget}</code>
              <button
                disabled={info?.libraryDirFromEnv}
                onClick={() =>
                  api
                    .pickFolder(t.settings.libraryDialog, libraryTarget)
                    .then((folder) => (folder ? change({ libraryDir: folder }) : undefined))
                    .catch(report)
                }
              >
                {t.settings.libraryChange}
              </button>
              <button
                disabled={info?.libraryDirFromEnv || settings.libraryDir === null}
                onClick={() => change({ libraryDir: null })}
              >
                {t.settings.libraryDefault}
              </button>
            </div>
            {info?.libraryDirFromEnv && <p className="hint">{t.settings.libraryFromEnv}</p>}
            {restartPending && libraryTarget && (
              <p className="hint">
                {t.settings.libraryRestart(libraryTarget)}{" "}
                <button className="primary" onClick={() => api.restart().catch(report)}>
                  {t.settings.restartNow}
                </button>
              </p>
            )}
          </div>
        </section>

        <section>
          <h2>{t.settings.editor}</h2>
          <div className="setting">
            <span>{t.settings.toolStyles}</span>
            <div className="setting-value">
              <span className="hint">{t.settings.toolStylesHint}</span>
              <button
                onClick={() =>
                  updateEditorSettings({ toolStyles: {} })
                    .then(() => setMessage(t.settings.toolStylesReset))
                    .catch(report)
                }
              >
                {t.settings.resetToolStyles}
              </button>
            </div>
          </div>
          <div className="setting">
            <span>{t.settings.quickStyles}</span>
            <div className="setting-value column">
              <p className="hint">{t.settings.quickStylesHint}</p>
              {quickStyles.length === 0 ? (
                <em>{t.settings.noQuickStyles}</em>
              ) : (
                <ul className="quick-style-list">
                  {quickStyles.map((quick) => (
                    <li key={quick.id}>
                      <StyleSwatch tool={quick.tool} style={quick.style} />
                      <span className="meta">{t.tools[quick.tool]}</span>
                      <input
                        aria-label={t.settings.quickStyleName}
                        defaultValue={quick.name}
                        onBlur={(e) => {
                          const name = e.target.value.trim();
                          if (name && name !== quick.name) {
                            void setQuickStyles(quickStyles.map((q) => (q.id === quick.id ? { ...q, name } : q)));
                          }
                        }}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      />
                      <button
                        className="danger"
                        onClick={() => setQuickStyles(quickStyles.filter((q) => q.id !== quick.id))}
                      >
                        {t.settings.deleteQuickStyle}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="row">
                <button disabled={!quickStyles.length} onClick={exportQuickStyles}>
                  {t.settings.exportQuickStyles}
                </button>
                <button onClick={importQuickStyles}>{t.settings.importQuickStyles}</button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
