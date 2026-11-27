// The changes lens's source adapter (D-224 §4, Q19). It reads the D-181 checkpoint through
// the same read-only `readWorktree` the AI gate uses, refreshes on the controller's snapshot
// notifications while the lens is open, and never writes to git or to `.facilis`.

import type { WorktreeSnapshot } from "@/ai/git-checkpoint";
import type { KernelBridge } from "@/vv/kernel";
import { LENS_AVAILABLE, type GraphLensSourceAdapter } from "./lens-lifecycle.ts";
import { buildChangesLensState } from "./changes-lens.ts";

/** The controller slice the changes lens needs. */
export interface ChangesLensController {
  readonly bridge: KernelBridge;
  readonly activeFolder: { readonly rootPath: string } | null;
  /** The controller's snapshot stream (files, git state, selection): a debounced refresh. */
  readonly subscribe: (listener: () => void) => () => void;
}

export type WorktreeReader = () => Promise<WorktreeSnapshot>;

/** Coalesce a burst of controller notifications into one status walk. */
const REFRESH_DEBOUNCE_MS = 750;

function gitReader(controller: ChangesLensController): WorktreeReader {
  // Imported lazily: the isomorphic-git chunk loads on the first lens open, never at boot.
  let checkpoint: ReturnType<typeof import("@/ai/git-checkpoint").createGitCheckpoint> | null =
    null;
  return async () => {
    if (checkpoint === null) {
      const { createGitCheckpoint } = await import("@/ai/git-checkpoint");
      checkpoint = createGitCheckpoint({
        bridge: controller.bridge,
        root: () => controller.activeFolder?.rootPath ?? null,
        // Read-only: the lens never commits or initializes a repository.
        commit: async () => ({ ok: false, error: "the changes lens is read-only" }),
        init: async () => ({ ok: false, error: "the changes lens is read-only" }),
      });
    }
    return checkpoint.readWorktree();
  };
}

export function createChangesLensSource(
  controller: ChangesLensController,
  read: WorktreeReader = gitReader(controller),
): GraphLensSourceAdapter {
  const listeners = new Set<() => void>();
  let snapshot: WorktreeSnapshot | null = null;
  let generation = 0;
  let stopWatching: (() => void) | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const notify = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };
  const refresh = async (): Promise<void> => {
    const token = ++generation;
    let next: WorktreeSnapshot;
    try {
      next = await read();
    } catch {
      next = { base: null, changes: [], failure: "error" };
    }
    // A newer walk (or a deactivation) supersedes this one: never publish a stale tree.
    if (token !== generation) return;
    snapshot = next;
    notify();
  };
  const schedule = (): void => {
    if (pending !== null) return;
    pending = setTimeout(() => {
      pending = null;
      void refresh();
    }, REFRESH_DEBOUNCE_MS);
  };
  return {
    source: "workspace",
    availability: () => LENS_AVAILABLE,
    activate() {
      snapshot = null;
      void refresh();
      stopWatching = controller.subscribe(schedule);
    },
    deactivate() {
      generation += 1;
      snapshot = null;
      stopWatching?.();
      stopWatching = null;
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
      }
    },
    state(_lens, context) {
      return buildChangesLensState(snapshot, context.view);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
