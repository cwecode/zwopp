import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A button that opens a panel below it; a click outside or Esc closes it.
 * `children` may be a function that receives `close`, e.g. for menu items.
 */
export function Popover({
  label,
  title,
  className,
  align = "left",
  children,
}: {
  label: ReactNode;
  title?: string;
  className?: string;
  align?: "left" | "right";
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="popover" ref={root}>
      <button
        className={[className, open && "active"].filter(Boolean).join(" ")}
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div className={`popover-panel ${align}`} role="dialog">
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** A floating menu at a point (e.g. a right-click), closed by a click outside or Esc. */
export function ContextMenu({
  at,
  onClose,
  children,
}: {
  at: { x: number; y: number };
  onClose(): void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);
  return (
    <div className="context-menu" role="menu" ref={root} style={{ left: at.x, top: at.y }} onClick={onClose}>
      {children}
    </div>
  );
}
