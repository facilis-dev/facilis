import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconMore } from "../icons.tsx";

export type RowMenuItem = {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly tone?: "default" | "danger";
  readonly onSelect: () => void;
};

export type RowMenuProps = {
  label: string;
  items: readonly RowMenuItem[];
};

/** Overflow menu for a table row: closes on outside pointer, Escape and item selection. */
export function RowMenu({ label, items }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="lab-menu" ref={rootRef}>
      <button
        type="button"
        className="lab-icon-btn lab-icon-btn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <IconMore />
      </button>
      {open ? (
        <div className="lab-menu__panel" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={
                "lab-menu__item" + (item.tone === "danger" ? " lab-menu__item--danger" : "")
              }
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
