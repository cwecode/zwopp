import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { App } from "./App";
import { Overlay } from "./capture/Overlay";
import { loadSettings } from "./settings/store";
import "./styles.css";

// One bundle serves every window; the window label decides what to render.
const label = getCurrentWindow().label;
const overlayIndex = label.startsWith("overlay-") ? Number(label.slice("overlay-".length)) : null;

// Loaded alongside the first render, which they rarely change (only a
// language other than the system's), so the window does not wait for them.
loadSettings().catch((e) => console.error("could not load the settings", e));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {overlayIndex === null ? <App /> : <Overlay index={overlayIndex} />}
  </React.StrictMode>,
);
