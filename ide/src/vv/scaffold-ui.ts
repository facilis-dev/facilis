// The "scaffold a template" dialog's open state (D-080).
//
// Its own store, like git-remote-ui.ts: controller.ts is at its length ratchet, so the
// dialog is opened from the empty-clone toast and the command palette and reads the
// target root here instead of a snapshot field. The root travels with the open flag
// because scaffolding writes into an existing folder, not a fresh one.

export interface ScaffoldUiState {
  open: boolean;
  root: string | null;
}

export class ScaffoldUi {
  private listeners = new Set<() => void>();
  private snap: ScaffoldUiState = { open: false, root: null };

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): ScaffoldUiState => this.snap;

  open(root: string): void {
    this.set({ open: true, root });
  }

  close(): void {
    // Drop the root too: a stale path must never be reopened by a later close/open race.
    this.set({ open: false, root: null });
  }

  private set(next: ScaffoldUiState): void {
    if (this.snap.open === next.open && this.snap.root === next.root) return;
    this.snap = next;
    for (const listener of this.listeners) listener();
  }
}

/** One IDE shell, one dialog. */
export const scaffoldUi = new ScaffoldUi();
