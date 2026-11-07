import { normalizePath } from "./path-resolver.ts";

/** Deterministic, browser-safe revision of the analyzed file set. */
export function computeRevision(files: ReadonlyMap<string, string>): string {
  const entries = [...files]
    .map(([path, source]) => [normalizePath(path), source] as const)
    .toSorted(([left], [right]) => left.localeCompare(right));
  let hash = 0x811c9dc5;
  for (const [path, source] of entries) {
    hash = mix(hash, path);
    hash = mix(hash, "\u0000");
    hash = mix(hash, source);
    hash = mix(hash, "\u0001");
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function mix(hash: number, value: string): number {
  let next = hash;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 0x01000193) >>> 0;
  }
  return next;
}
