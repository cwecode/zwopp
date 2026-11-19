import { useEffect, useState } from "react";
import * as api from "../api";
import { formatAccelerator, useT } from "../i18n";
import { HotkeyPicker } from "./HotkeyPicker";
import { updateSettings, useSettings } from "./store";

const STEPS = 3;

/**
 * The first start: language, capture hotkey, start at login – three short
 * steps, each also in the settings later. The same on every system (ADR 0014).
 */
export function WelcomePage({ onDone }: { onDone(): void }) {
  const t = useT();
  const settings = useSettings();
  const [step, setStep] = useState(0);
  const [info, setInfo] = useState<api.SettingsInfo>();
  /** Undefined while loading, null in a development build. */
  const [autostart, setAutostart] = useState<boolean | null>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    api.getSettings().then(setInfo).catch((e) => setMessage(String(e)));
    api.getAutostart().then(setAutostart).catch(() => setAutostart(null));
  }, []);

  const finish = () =>
    updateSettings({ setupDone: true })
      .then(onDone)
      .catch((e) => setMessage(String(e)));

  const language = (value: string | null) => updateSettings({ language: value }).catch((e) => setMessage(String(e)));
  const shortcut = info?.captureShortcut;

  return (
    <div className="welcome">
      <div className="welcome-card">
        <p className="welcome-step">{t.welcome.step(step + 1, STEPS)}</p>

        {step === 0 && (
          <>
            <h1>{t.welcome.title}</h1>
            <p>{t.welcome.intro}</p>
            <h2>{t.welcome.language}</h2>
            <div className="welcome-choices">
              {(
                [
                  [null, t.settings.systemLanguage],
                  ["de", t.settings.languages.de],
                  ["en", t.settings.languages.en],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  className={settings.language === value ? "active" : undefined}
                  aria-pressed={settings.language === value}
                  onClick={() => void language(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1>{t.welcome.hotkeyTitle}</h1>
            <p>{t.welcome.hotkeyIntro}</p>
            <HotkeyPicker shortcut={shortcut} onChange={setInfo} onMessage={setMessage} />
          </>
        )}

        {step === 2 && (
          <>
            <h1>{t.welcome.readyTitle}</h1>
            <p>{shortcut ? t.welcome.readyHotkey(formatAccelerator(t, shortcut)) : t.welcome.readyNoHotkey}</p>
            <p>{t.welcome.readyBar}</p>
            {autostart !== null && autostart !== undefined && (
              <label className="welcome-check">
                <input
                  type="checkbox"
                  checked={autostart}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    api
                      .setAutostart(enabled)
                      .then(() => setAutostart(enabled))
                      .catch((err) => setMessage(String(err)));
                  }}
                />
                {t.settings.autostart}
              </label>
            )}
          </>
        )}

        {message && (
          <p className="welcome-message" role="status">
            {message}
          </p>
        )}

        <div className="welcome-actions">
          <button className="link" onClick={() => void finish()}>
            {t.welcome.skip}
          </button>
          <span className="spacer" />
          {step > 0 && <button onClick={() => setStep(step - 1)}>{t.welcome.back}</button>}
          {step < STEPS - 1 ? (
            <button className="primary" onClick={() => setStep(step + 1)}>
              {t.welcome.next}
            </button>
          ) : (
            <button className="primary" onClick={() => void finish()}>
              {t.welcome.done}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
