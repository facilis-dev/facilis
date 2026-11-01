import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { cx } from "./class-names.ts";
import "./menu.css";
import "./icon-button.css";

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  onSelect: () => void;
};

export type MenuProps = {
  /** Accessible name for the trigger and the menu. */
  label: string;
  items: readonly MenuItem[];
  /** Trigger content; defaults to a vertical ellipsis. */
  trigger?: ReactNode;
  /** Opens the menu initially (demos and server renders; the menu is otherwise uncontrolled). */
  defaultOpen?: boolean;
  className?: string;
};

/**
 * Accessible overflow menu: aria-haspopup/menu, outside pointer and Escape close, focus moves
 * to the first item on open and back to the trigger on Escape, arrows/Home/End navigate items.
 */
export function Menu({ label, items, trigger, defaultOpen = false, className }: MenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const panel = panelRef.current;
    if (panel === null) return;
    const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    if (event.key === "Home") buttons[0]?.focus();
    else if (event.key === "End") buttons[buttons.length - 1]?.focus();
    else {
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (index + step + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }

  function select(item: MenuItem): void {
    setOpen(false);
    item.onSelect();
  }

  return (
    <div className={cx("fc-menu", className)} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="fc-icon-btn fc-icon-btn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? <span aria-hidden="true">⋯</span>}
      </button>
      {open ? (
        <div
          className="fc-menu__panel"
          role="menu"
          aria-label={label}
          ref={panelRef}
          onKeyDown={onPanelKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={cx("fc-menu__item", item.tone === "danger" && "fc-menu__item--danger")}
              onClick={() => select(item)}
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
