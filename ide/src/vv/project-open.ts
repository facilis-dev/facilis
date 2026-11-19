// Re-entrancy guard for openProject (issue #51): Home's recent rows and the ?project=
// tab boot both reach the controller, and a cold-start click queues on whenKernelReady
// before the deferred OPFS replay (D-036) runs. Without a guard, rapid clicks start
// overlapping restores and workspace opens. Lives outside controller.ts because the
// file-length ratchet pins that file.

/** Runs `open` for `root`; a no-op while an open for the same root is in flight. */
export type ProjectOpenGuard = (root: string, open: () => Promise<void>) => Promise<void>;

export function createProjectOpenGuard(): ProjectOpenGuard {
  const inFlight = new Set<string>();
  return async (root, open) => {
    if (inFlight.has(root)) return;
    inFlight.add(root);
    try {
      await open();
    } finally {
      // Release even on failure: a project that vanished (or a restore that threw)
      // must stay openable again once the cause is gone.
      inFlight.delete(root);
    }
  };
}
