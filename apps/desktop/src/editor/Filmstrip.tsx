import { useEffect, useRef } from "react";
import { fileUrl, type LibraryItem } from "../api";

interface Props {
  items: LibraryItem[];
  currentId: string;
  onOpen(item: LibraryItem): void;
}

/** Library items along the bottom of the editor, newest first. */
export function Filmstrip({ items, currentId, onOpen }: Props) {
  const current = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [currentId, items.length]);

  const index = items.findIndex((i) => i.id === currentId);

  return (
    <nav className="filmstrip" aria-label="Bibliothek">
      <button
        className="filmstrip-step"
        disabled={index <= 0}
        onClick={() => onOpen(items[index - 1])}
        title="Neuerer Screenshot (Alt+←)"
      >
        ‹
      </button>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button
              ref={item.id === currentId ? current : undefined}
              className={item.id === currentId ? "filmstrip-item current" : "filmstrip-item"}
              aria-current={item.id === currentId}
              title={item.title || new Date(item.createdAt).toLocaleString("de-DE")}
              onClick={() => onOpen(item)}
            >
              <img src={fileUrl(item.thumbPath, item.updatedAt)} alt="" loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      <button
        className="filmstrip-step"
        disabled={index < 0 || index >= items.length - 1}
        onClick={() => onOpen(items[index + 1])}
        title="Älterer Screenshot (Alt+→)"
      >
        ›
      </button>
    </nav>
  );
}
