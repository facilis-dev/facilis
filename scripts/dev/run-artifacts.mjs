// Keep the smoke artifact roots bounded. Every run writes a timestamped directory
// (profile + home + screenshots + report.json, hundreds of MB); without pruning they
// filled $FACILIS_TOOLING_DIR with 72 GB of smoke-artifacts by 2026-11-07. A finished run
// deletes the dirs beyond the newest SMOKE_KEEP_RUNS (default 5): best effort, so a stale
// directory that cannot be removed never fails a smoke.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const DEFAULT_KEEP_RUNS = 5;

/** SMOKE_KEEP_RUNS override (positive integer), else DEFAULT_KEEP_RUNS. */
export function keepRunsFromEnv() {
  const raw = process.env.SMOKE_KEEP_RUNS;
  if (raw === undefined || raw === "") return DEFAULT_KEEP_RUNS;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_KEEP_RUNS;
}

/**
 * Delete every run directory (epoch-ms name) under `root` beyond the newest `keep`.
 * Names in `protect` are always kept. Returns the removed names; throws only for a
 * programming error, never for a directory that is busy.
 */
export function pruneRunDirs(root, keep = DEFAULT_KEEP_RUNS, protect = new Set()) {
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const runs = names.filter((name) => /^\d+$/.test(name)).toSorted((a, b) => Number(b) - Number(a));
  const keepSet = new Set(runs.slice(0, Math.max(keep, 1)));
  // The run that just finished is never pruned, even if its dir is not the newest
  // (a clock skew would otherwise delete the evidence the operator is about to open).
  for (const name of protect) keepSet.add(name);
  const removed = [];
  for (const name of runs) {
    if (keepSet.has(name)) continue;
    try {
      fs.rmSync(path.join(root, name), { recursive: true, force: true, maxRetries: 3 });
      removed.push(name);
    } catch {
      // Best effort: never fail a smoke run because a stale directory is busy.
    }
  }
  return removed;
}

/**
 * Prune the default artifacts root after a run. A custom SMOKE_ARTIFACTS means the
 * operator owns the layout, and --keep-artifacts asks to keep every run; both skip.
 */
export function pruneSmokeArtifacts({ root, artifacts, keepArtifacts = false }) {
  if (keepArtifacts || process.env.SMOKE_ARTIFACTS) return [];
  if (path.dirname(path.resolve(artifacts)) !== path.resolve(root)) return [];
  const removed = pruneRunDirs(root, keepRunsFromEnv(), new Set([path.basename(artifacts)]));
  for (const name of removed) console.log("pruned old artifacts: " + path.join(root, name));
  return removed;
}
