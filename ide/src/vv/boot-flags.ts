// Dev-only bisect switch for the boot options the IDE hands the kernel, because the
// difference between a cold boot and a warm reload is exactly where the in-VM dev server
// stalls: `?boot=-deferCacheFiles` (or `-mirrorLane`, `-deferRestoreRoots`) turns one lever
// off for that tab, so a bug report can say which lever the stall needs instead of
// guessing. Production builds ignore it: an embedder's users get the shipped behaviour.

export type BootFlagName = "deferRestoreRoots" | "deferCacheFiles" | "mirrorLane";

const FLAGS: readonly BootFlagName[] = ["deferRestoreRoots", "deferCacheFiles", "mirrorLane"];

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
    if (FLAGS.includes(bare)) out[bare] = on;
  }
  return out;
}

let overrides: Partial<Record<BootFlagName, boolean>> | null = null;

/** One flag's effective value: the query override in dev, the shipped default otherwise. */
export function bootFlag(name: BootFlagName): boolean {
  if (!import.meta.env.DEV) return true;
  if (overrides === null) {
    overrides = typeof location === "undefined" ? {} : parseBootFlags(location.search);
  }
  return overrides[name] ?? true;
}
