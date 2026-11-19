// The commit box's generation state machine (D-197), free of React so it is unit-tested.
//
// One instance per repository. It owns the AbortController and the request id that make
// "only the latest generation fills the box" true: a second start aborts the first, and a
// result that lands after a newer request (or after unmount) is dropped. It never commits —
// commit() exists only for the user's own button, and generation has no path to it.

import type {
  CommitGenerationFailure,
  CommitGenerationResult,
} from "@/ai/commit-generation";

/** The seams the box needs; the React container binds them to ScmSession. */
export interface CommitBoxPorts {
  readonly root: string;
  generate(input: { root: string; signal: AbortSignal }): Promise<CommitGenerationResult>;
  /** The live textarea text (the SCM snapshot, not the render's stale prop). */
  readMessage(): string;
  writeMessage(message: string): void;
  /** The user's Commit click; generation must never call this. */
  commit(): void;
}

export interface CommitBoxSnapshot {
  readonly running: boolean;
  /** A failure to show inline next to the box; the box's text is untouched. */
  readonly error: CommitGenerationFailure | null;
  /** A generated message waiting for the user's explicit "replace" click. */
  readonly pending: string | null;
}

export interface CommitBox {
  subscribe(listener: () => void): () => void;
  getSnapshot(): CommitBoxSnapshot;
  start(): Promise<void>;
  confirm(): void;
  dismiss(): void;
  commit(): void;
  dispose(): void;
}

export function createCommitBox(ports: CommitBoxPorts): CommitBox {
  let listeners = new Set<() => void>();
  let controller: AbortController | null = null;
  let seq = 0;
  let snap: CommitBoxSnapshot = { running: false, error: null, pending: null };

  const emit = (patch: Partial<CommitBoxSnapshot>): void => {
    snap = { ...snap, ...patch };
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snap,

    async start() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const id = ++seq;
      emit({ running: true, error: null, pending: null });

      let result: CommitGenerationResult;
      try {
        result = await ports.generate({ root: ports.root, signal: current.signal });
      } catch (error) {
        // The generator promises not to throw; this is the box's last line of defence.
        result = {
          ok: false,
          failure: { reason: "failed", message: error instanceof Error ? error.message : String(error) },
        };
      }
      // A newer start (or dispose) owns the box now: this result is stale.
      if (id !== seq || current.signal.aborted) return;
      controller = null;

      if (!result.ok) {
        const aborted = result.failure.reason === "aborted";
        emit({ running: false, error: aborted ? null : result.failure, pending: null });
        return;
      }
      // The user's own text is never overwritten silently: ask for an explicit confirmation.
      if (ports.readMessage().trim().length > 0) {
        emit({ running: false, error: null, pending: result.message });
        return;
      }
      ports.writeMessage(result.message);
      emit({ running: false, error: null, pending: null });
    },

    confirm() {
      if (snap.pending === null) return;
      ports.writeMessage(snap.pending);
      emit({ pending: null, error: null });
    },

    dismiss() {
      if (snap.pending !== null) emit({ pending: null });
    },

    commit() {
      ports.commit();
    },

    dispose() {
      seq += 1;
      controller?.abort();
      controller = null;
      listeners = new Set();
    },
  };
}
