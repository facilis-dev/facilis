// The keyboard-shortcuts help dialog's open state (issue #223). Its own store, like
// reset-ui.ts: the registry's "?" binding dispatches from AppShell and the palette command
// opens the same dialog, so the flag is shell UI state rather than an IdeSnapshot field.
export class ShortcutHelpUi {
  private listeners = new Set<() => void>();
  private isOpen = false;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): boolean => this.isOpen;

  open = (): void => {
    this.setOpen(true);
  };

  close = (): void => {
    this.setOpen(false);
  };

  private setOpen(open: boolean): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    for (const listener of this.listeners) listener();
  }
}

/** One IDE shell, one help dialog. */
export const shortcutHelpUi = new ShortcutHelpUi();
