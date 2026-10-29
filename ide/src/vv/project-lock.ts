// One project, one tab.
//
// The kernel's filesystem is per ORIGIN, and so is the OPFS mirror behind it: two
// tabs on the same project would restore the same tree into two independent RAM
// copies and then mirror both back, last-writer-wins per file — the exact silent
// divergence a tabbed IDE must not allow. Different projects are fine: the mirror is
// per path, and nothing else is shared.
//
// The claim is a Web Lock, which the browser releases when the document goes away
// (reload, crash, close), so a dead tab can never keep a project hostage. Where the
// API is missing the claim degrades to "allowed": a visible editor without the guard
// is better than no editor.
const LOCK_PREFIX = "facilis-project:";
// A reload's old document can outlive the new one for a moment; a claim that fails is
// retried a few times before it is reported as another tab's.
const CLAIM_ATTEMPTS = 3;
const CLAIM_RETRY_MS = 150;

export interface ProjectClaim {
  release(): void;
}

function tryClaim(locks: LockManager, name: string): Promise<ProjectClaim | null> {
  return new Promise((resolve) => {
    void locks.request(name, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return undefined;
      }
      let release = () => {};
      const held = new Promise<void>((r) => {
        release = r;
      });
      resolve({ release });
      return held; // the lock lives as long as this promise is pending
    });
  });
}

/** Claim `rootPath` for this tab, or null when another live tab already holds it. */
export async function claimProject(rootPath: string): Promise<ProjectClaim | null> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== "function") return { release: () => {} };
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const claim = await tryClaim(locks, LOCK_PREFIX + rootPath);
    if (claim) return claim;
    if (attempt < CLAIM_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, CLAIM_RETRY_MS));
  }
  return null;
}
