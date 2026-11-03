import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadSettings } from "./settings/store";
import { rememberedTheme } from "./settings/theme";
import "./styles.css";

// One bundle serves every window; the window label decides what to render.
const label = getCurrentWindow().label;
const overlayIndex = label.startsWith("overlay-") ? Number(label.slice("overlay-".length)) : null;

// The theme from the last start, so the window does not flash in the other one.
const theme = rememberedTheme();
if (theme) document.documentElement.dataset.theme = theme;

// Loaded alongside the first render, which they rarely change (only a
// language other than the system's), so the window does not wait for them.
loadSettings().catch((e) => console.error("could not load the settings", e));

// Each window loads only its own code: the capture overlays stay loaded in
// the background all the time, so they leave out the library and the editor.
const view =
  overlayIndex !== null
    ? import("./capture/Overlay").then(({ Overlay }) => <Overlay index={overlayIndex} />)
    : label.startsWith("recorder-")
      ? import("./capture/Recorder").then(({ RecorderBar, RecorderFrame }) => {
          // These windows are transparent around what they draw.
          document.documentElement.classList.add("transparent");
          return label === "recorder-bar" ? <RecorderBar /> : <RecorderFrame />;
        })
      : import("./App").then(({ App }) => <App />);

void view.then((element) =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{element}</React.StrictMode>,
  ),
);
