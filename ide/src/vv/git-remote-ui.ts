// The "Git remotes" dialog's open state (D-079).
//
// Its own store, like publish-session.ts: controller.ts is at its length ratchet, so the
// dialog is opened by the command palette and reads the session the controller exposes
// (`c.gitRemote`) instead of a fourth transfer field on the snapshot.

export interface GitRemoteUiState {
  open: boolean;
}

export class GitRemoteUi {
  private listeners = new Set<() => void>();
  private snap: GitRemoteUiState = { open: false };

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): GitRemoteUiState => this.snap;

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

/** One IDE shell, one dialog. */
export const gitRemoteUi = new GitRemoteUi();
