// The "reset everything" dialog's open state (D-189).
//
// Its own store, like scaffold-ui.ts and git-remote-ui.ts: controller.ts is at its length
// ratchet, and Home and the command palette both open this dialog, so the flag is shell UI
// state rather than an IdeSnapshot field. The wipe itself stays on the controller
// (resetEverything), which is where the kernel teardown and the reload live.
export class ResetUi {
  private listeners = new Set<() => void>();
  private isOpen = false;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): boolean => this.isOpen;

  open(): void {
    this.setOpen(true);
  }

  close(): void {
    this.setOpen(false);
  }

  private setOpen(open: boolean): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    for (const listener of this.listeners) listener();
  }
}

/** One IDE shell, one dialog. */
export const resetUi = new ResetUi();
