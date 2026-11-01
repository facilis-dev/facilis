// The "Publish to a git host" dialog's open state (D-078).
//
// Its own store, like StatusMessage and the SCM snapshot: the trigger lives in the
// command palette (and later in Source Control), while the transfer itself goes through
// the controller's public project-export API. The controller file is at its length
// ratchet (scripts/file-length-baseline.json), so a fourth transfer field there would
// have to buy its lines elsewhere; a boot-free store costs nothing.

export interface PublishUiState {
  open: boolean;
}

export class PublishSession {
  private listeners = new Set<() => void>();
  private snap: PublishUiState = { open: false };

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): PublishUiState => this.snap;

  open(): void {
    this.set(true);
  }

  close(): void {
    this.set(false);
  }

  private set(open: boolean): void {
    if (this.snap.open === open) return;
    this.snap = { open };
    for (const listener of this.listeners) listener();
  }
}

/** The one dialog instance's state; a module singleton because there is one IDE shell. */
export const publishSession = new PublishSession();
