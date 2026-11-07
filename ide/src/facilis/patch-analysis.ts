// Before/after analyses for a proposed patch set (SPEC §9.3, invariant 9; task-10).
//
// The AI validator reads the analyzer's fact model instead of re-parsing the project: the
// caller gets the pre-patch analysis and the analysis of the project with the patch written
// in (or the file deleted). Both run on the one warm analyzer worker (analyze-client.ts);
// the pre-patch one is cached per VFS snapshot so repeated review rounds do not re-analyze
// the unchanged project.
//
// This module is deliberately UI-free: the IDE's ChatHost adapter and patch-validation.ts are
// the only callers.

import type { FilePatch } from "@facilis/ai";
import type { Analysis } from "@facilis/analyze";
import type { IdeController } from "@/vv/controller";
import {
  analyzeProjectFiles,
  loadProjectSources,
  type ProjectSourceResult,
} from "./analyze-client";

export interface PatchAnalyses {
  readonly before: Analysis;
  readonly after: Analysis;
}

/** Paths cross the AI boundary root-relative; keep the map keys in that shape. */
function normalizePatchPath(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  return slashed.replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * The project file map after the patch set: create/update content wins, deletes disappear.
 * A patched file is added even when the base selector did not include it — the AI can touch
 * any project file, and the analyzer only extracts facts from files it recognises. Pure, and
 * deliberately not limited to the analyzer's selection: the selection is a read optimization,
 * not a statement about which files exist.
 */
export function overlayPatches(
  base: ReadonlyMap<string, string>,
  patches: readonly FilePatch[],
): Map<string, string> {
  const files = new Map(base);
  for (const patch of patches) {
    const path = normalizePatchPath(patch.path);
    if (path.length === 0) continue;
    if (patch.action === "delete") {
      files.delete(path);
    } else if (typeof patch.content === "string") {
      files.set(path, patch.content);
    }
  }
  return files;
}

function abortError(): Error {
  const error = new Error("patch analysis aborted");
  error.name = "AbortError";
  return error;
}

/** Honour a cancellation between analysis steps; the worker request itself is not aborted. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError();
}

interface BeforeCacheEntry {
  readonly base: ReadonlyMap<string, string>;
  readonly analysis: Promise<Analysis>;
}

let beforeCache: BeforeCacheEntry | null = null;

async function analyzed(files: ReadonlyMap<string, string>): Promise<Analysis> {
  const result = await analyzeProjectFiles(files);
  if (!result.ok) throw new Error(result.error);
  return result.analysis;
}

/** Pre-patch analysis, cached by the base map identity (one snapshot = one map). */
function beforeAnalysis(base: ReadonlyMap<string, string>): Promise<Analysis> {
  const cached = beforeCache;
  if (cached !== null && cached.base === base) return cached.analysis;
  const analysis = analyzed(base);
  const entry: BeforeCacheEntry = { base, analysis };
  beforeCache = entry;
  // A failed analysis must not be pinned to the snapshot: retry on the next proposal.
  analysis.catch(() => {
    if (beforeCache === entry) beforeCache = null;
  });
  return analysis;
}

/**
 * Analyze the project before and after a patch set. Throws on analyzer failure (the caller
 * turns it into a blocking validation result) and on cancellation (an AbortError-like Error);
 * it never returns partial analyses.
 */
export async function analyzePatches(
  controller: IdeController,
  patches: readonly FilePatch[],
  signal?: AbortSignal,
): Promise<PatchAnalyses> {
  throwIfAborted(signal);
  const sources: ProjectSourceResult = await loadProjectSources(controller);
  if (!sources.ok) throw new Error(sources.error);
  throwIfAborted(signal);

  const before = await beforeAnalysis(sources.files);
  throwIfAborted(signal);

  const effective = overlayPatches(sources.files, patches);
  throwIfAborted(signal);

  const after = await analyzed(effective);
  throwIfAborted(signal);
  return { before, after };
}
