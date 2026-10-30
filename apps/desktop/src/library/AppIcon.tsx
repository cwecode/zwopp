import { fileUrl } from "../api";

/** A hue that stays the same for an application name, for its initial. */
export function appHue(app: string): number {
  let hash = 0;
  for (const char of app) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % 360;
}

/**
 * An application's icon, or, where none was saved (not on Windows, or not
 * yet), its initial on a colour of its own.
 */
export function AppIcon({ app, icon, size = 16 }: { app: string; icon?: string | null; size?: number }) {
  if (icon) {
    // The icon of an application never changes its file name, only its pixels.
    return <img className="app-icon" src={fileUrl(icon, app)} alt="" width={size} height={size} />;
  }
  const initial = [...app.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span
      className="app-icon app-initial"
      style={{ width: size, height: size, fontSize: size * 0.62, background: `hsl(${appHue(app)} 55% 45%)` }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
