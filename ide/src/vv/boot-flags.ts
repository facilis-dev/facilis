// Dev-only bisect switch for the boot options the IDE hands the kernel, because the
// difference between a cold boot and a warm reload is exactly where the in-VM dev server
// stalls: `?boot=-deferCacheFiles` (or `-mirrorLane`, `-deferRestoreRoots`) turns one lever
// off for that tab, so a bug report can say which lever the stall needs instead of
// guessing. Production builds ignore it: an embedder's users get the shipped behaviour.

export type BootFlagName = "deferRestoreRoots" | "deferCacheFiles" | "mirrorLane" | "depCache";

const FLAGS = new Set<BootFlagName>([
  "deferRestoreRoots",
  "deferCacheFiles",
  "mirrorLane",
  "depCache",
]);

/** `?boot=-mirrorLane,-deferCacheFiles`: the named levers off, everything else on. */
export function parseBootFlags(search: string): Partial<Record<BootFlagName, boolean>> {
  const out: Partial<Record<BootFlagName, boolean>> = {};
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get("boot");
  } catch {
    return out; // a malformed search string must not break boot
  }
  if (!raw) return out;
  for (const token of raw.split(",")) {
    const name = token.trim();
    const on = !name.startsWith("-");
    const bare = (on ? name : name.slice(1)) as BootFlagName;
    if (FLAGS.has(bare)) out[bare] = on;
  }
  return out;
}

let overrides: Partial<Record<BootFlagName, boolean>> | null = null;

/** One flag's effective value: the query override in dev, the shipped default otherwise. */
export function bootFlag(name: BootFlagName): boolean {
  if (!import.meta.env.DEV) return true;
  if (overrides === null) {
    overrides = typeof location === "undefined" ? {} : parseBootFlags(location.search);
    // Say the effective set once: an A/B that silently did not apply reads as a null result.
    // oxlint-disable-next-line no-console -- the bisect result must be visible in the console.
    console.debug("[boot] flags", overrides);
  }
  return overrides[name] ?? true;
}

/**
 * `-depCache`: drop the persistent node_modules snapshot store before the kernel opens it, so
 * this boot installs instead of restoring. The only way to compare "install every boot" with
 * "restore every boot" on the same project, and the lever a bisect needs when the restore is
 * the suspect.
 */
export async function dropDepCacheIfAsked(): Promise<boolean> {
  if (bootFlag("depCache") || typeof navigator === "undefined") return false;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("vv-depcache", { recursive: true });
    return true;
  } catch {
    return false; // nothing persisted yet, or the browser refused: the boot proceeds
  }
}
