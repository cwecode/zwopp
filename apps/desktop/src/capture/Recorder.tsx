import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  cancelRecording,
  captureShortcut,
  stopRecording,
  type RecordingMode,
  type RecordingProgress,
} from "../api";
import { formatAccelerator, useT } from "../i18n";

/** The frame around a region while it is recorded; clicks go through it. */
export function RecorderFrame() {
  return <div className="recorder-frame" />;
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The bar next to the region while it is recorded: progress, Done, Cancel. */
export function RecorderBar() {
  const t = useT();
  const [progress, setProgress] = useState<RecordingProgress>();
  const [shortcut, setShortcut] = useState("");
  /** The panorama's height before anything was scrolled: the area's own. */
  const startHeight = useRef<number | undefined>(undefined);

  useEffect(() => {
    captureShortcut()
      .then((s) => setShortcut(s ? formatAccelerator(t, s) : ""))
      .catch(() => {});
    const unlisten = listen<RecordingProgress>("recording:progress", (e) => {
      startHeight.current ??= e.payload.height;
      setProgress(e.payload);
    });
    return () => void unlisten.then((fn) => fn());
  }, [t]);

  const mode: RecordingMode = progress?.mode ?? "panorama";
  const text = t.capture.recording;
  const status = !progress
    ? ""
    : progress.full
      ? mode === "gif"
        ? text.fullGif
        : text.fullPanorama
      : mode === "panorama"
        ? progress.lost
          ? text.lost
          : progress.height > (startHeight.current ?? 0)
            ? text.pixels(progress.height)
            : text.scroll
        : "";

  return (
    <div className="recorder-bar" data-lost={progress?.lost || undefined}>
      <span className="recorder-dot" aria-hidden="true" />
      <strong>{text[mode]}</strong>
      <span className="recorder-time">{clock(progress?.seconds ?? 0)}</span>
      <span className="recorder-status">{status}</span>
      <button className="primary" title={text.doneTitle(shortcut)} onClick={() => void stopRecording()}>
        {text.done}
      </button>
      <button title={text.cancel} aria-label={text.cancel} onClick={() => void cancelRecording()}>
        ✕
      </button>
    </div>
  );
}
