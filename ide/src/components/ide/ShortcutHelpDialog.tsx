// The keyboard-shortcuts help (issue #223): one list rendered from the registry, grouped by
// context and spelled for this platform, opened from the palette or with "?". It is honest
// about its edges: the browser-reserved chords are listed (with the reason), and the footer
// names the bindings that are NOT here — Escape's ladders and Monaco's/xterm's own keys.
import { useEffect, useRef } from "react";
import X from "~icons/lucide/x";
import { t, type MessageKey } from "@/i18n";
import {
  SHORTCUTS,
  formatShortcut,
  type RegisteredShortcut,
  type ShortcutContext,
} from "./shortcuts";

const GROUP_LABEL: Record<ShortcutContext, MessageKey> = {
  global: "shortcuts.group.global",
  editor: "shortcuts.group.editor",
  terminal: "shortcuts.group.terminal",
  dialog: "shortcuts.group.dialog",
  overlay: "shortcuts.group.overlay",
};

const CONTEXTS: readonly ShortcutContext[] = ["global", "editor", "terminal", "dialog", "overlay"];

function ShortcutRow({ entry }: { entry: RegisteredShortcut }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="min-w-0 text-xs text-foreground">
        {t(entry.labelKey, entry.labelParams)}
        {entry.noteKey !== undefined && (
          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
            {t(entry.noteKey)}
          </span>
        )}
      </span>
      <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        {formatShortcut(entry.id)}
      </kbd>
    </li>
  );
}

export function ShortcutHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Focus moves into the dialog and comes back to whatever opened it. The dialog owns Escape
  // itself — that is the one ladder the registry deliberately does not model.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const reserved = SHORTCUTS.filter((entry) => entry.reservedByBrowser);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-overlay/60 p-4 pt-[10vh] backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        data-testid="shortcut-help"
        tabIndex={-1}
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-panel shadow-xl outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 id="shortcut-help-title" className="text-sm font-semibold text-foreground">
              {t("shortcuts.dialogTitle")}
            </h2>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {t("shortcuts.dialogHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("shortcuts.close")}
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-2">
          {CONTEXTS.map((context) => {
            const entries = SHORTCUTS.filter(
              (entry) => entry.context === context && !entry.reservedByBrowser,
            );
            if (entries.length === 0) return null;
            return (
              <section key={context} aria-labelledby={"shortcut-help-" + context}>
                <h3
                  id={"shortcut-help-" + context}
                  className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
                >
                  {t(GROUP_LABEL[context])}
                </h3>
                <ul>
                  {entries.map((entry) => (
                    <ShortcutRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              </section>
            );
          })}
          {reserved.length > 0 && (
            <section aria-labelledby="shortcut-help-browser">
              <h3
                id="shortcut-help-browser"
                className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              >
                {t("shortcuts.group.browser")}
              </h3>
              <ul>
                {reserved.map((entry) => (
                  <ShortcutRow key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          )}
        </div>
        <footer className="border-t px-4 py-3 text-[10px] leading-snug text-muted-foreground">
          <p className="mb-1 text-[11px] font-medium text-foreground">
            {t("shortcuts.notInRegistry.title")}
          </p>
          <p>{t("shortcuts.notInRegistry.escape")}</p>
          <p className="mt-1">{t("shortcuts.notInRegistry.editors")}</p>
        </footer>
      </div>
    </div>
  );
}
