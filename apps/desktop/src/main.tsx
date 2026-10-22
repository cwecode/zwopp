import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Library } from "./library/Library";
import { Overlay } from "./capture/Overlay";
import "./styles.css";

// One bundle serves every window; the window label decides what to render.
const label = getCurrentWindow().label;
const overlayIndex = label.startsWith("overlay-") ? Number(label.slice("overlay-".length)) : null;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {overlayIndex === null ? <Library /> : <Overlay index={overlayIndex} />}
  </React.StrictMode>,
);
