import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconX } from "../icons.tsx";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal overlay: role=dialog + aria-modal, Esc and backdrop close, focus moved in
 * on open and restored on close, and Tab kept inside the panel. The lab has no dialog
 * primitive in @facilis/ui yet, so this is the copyable pattern the kit should grow next.
 */
export function Dialog({ open, onClose, title, description, children, footer }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest close callback without re-running the focus effect while the dialog is
  // open: a parent re-render (typing in a controlled field) must not steal focus.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || panel === null) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (firstItem === undefined || lastItem === undefined) {
        event.preventDefault();
        panel.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="lab-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="lab-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="lab-dialog__header">
          <div>
            <h2 className="lab-dialog__title" id={titleId}>
              {title}
            </h2>
            {description === undefined ? null : (
              <p className="lab-dialog__desc" id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="lab-icon-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <IconX />
          </button>
        </header>
        {children === undefined ? null : <div className="lab-dialog__body">{children}</div>}
        {footer === undefined ? null : <div className="lab-dialog__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
