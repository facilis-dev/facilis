// Real analyzer facts for the IDE validator tests (task-10).
//
// The validator no longer parses the project itself, so test hosts must supply actual
// @facilis/analyze facts. These helpers build them from small source maps with the same
// parser adapter the browser worker uses; under Vitest/Node the resolver picks oxc-parser's
// native binding, so no wasm is booted. Test-only — nothing in the app imports this module.

import type { FilePatch } from "@facilis/ai";
import { analyzeProject, type Analysis } from "@facilis/analyze";
import { createBrowserOxcParser } from "@/facilis/oxc-browser";
import { overlayPatches } from "@/facilis/patch-analysis";

const parser = createBrowserOxcParser();

/** Analyze a project-relative source map into the fact model. */
export function analyzeSources(files: ReadonlyMap<string, string>): Analysis {
  return analyzeProject({ files, parser });
}

/** Pre/post analyses for a patch set, the way the worker reports them. */
export function analyzePatchesOf(
  base: ReadonlyMap<string, string>,
  patches: readonly FilePatch[],
): { before: Analysis; after: Analysis } {
  return { before: analyzeSources(base), after: analyzeSources(overlayPatches(base, patches)) };
}

/**
 * Test-host adapter: read the host's pre-patch file list through its own VFS seam, then
 * analyze it pre/post patch. Hosts whose sources change between calls (a project edited
 * after the proposal) get fresh facts on every validation round.
 */
export async function analyzeHostFiles(
  files: readonly string[],
  read: (path: string) => Promise<string>,
  patches: readonly FilePatch[],
): Promise<{ before: Analysis; after: Analysis }> {
  const base = new Map<string, string>();
  for (const path of files) {
    const content = await read(path);
    if (content.length > 0) base.set(path, content);
  }
  return analyzePatchesOf(base, patches);
}
