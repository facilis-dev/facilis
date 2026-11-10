// Project material for the patch validator (SPEC §9.3 wiring; task-10).
//
// After the analyzer cutover the validator's facts come from @facilis/analyze, not from
// sources this module reads. Only two files still need their bytes here: package.json
// (installed packages) and tsconfig.json (path aliases) — the analyzer does not model them.
// The live manifest is still fetched best-effort; it only contributes blocks and a locale
// fallback. The pre/post analyses themselves arrive through the host's analyze() seam.

import type { Analysis, FilePatch, SyntaxChecker } from "@facilis/ai";
import { fetchManifest } from "@/facilis/manifest-client";
import type { GitAccess } from "./git-access";
import type { GraphAccess } from "./graph-access";
import type { PreviewAccess } from "./preview-access";

/** The slice of ChatHost the contextual validation needs. */
export interface PatchContextHost {
  /** Project-relative paths that exist before the patch. */
  files(): readonly string[];
  read(path: string): Promise<string>;
  /** Preview base URL for /__facilis/manifest, or null when nothing runs. */
  manifestBase(): string | null;
  /** Rule 1's parser (the analyzer worker's oxc parser in the IDE); null when unavailable. */
  syntaxChecker?(): SyntaxChecker | null;
  /** The running preview, when the IDE has one (D-111): the preview tools drive the app. */
  preview?: PreviewAccess;
  /**
   * The project graph's committed state (D-126), when the project is analyzable. The graph tools
   * write `.facilis/graph` directly: it is team state, not source code, so it needs no proposal.
   */
  graph?: GraphAccess;
  /**
   * The project's own repository and remotes (D-139). These tools are repository operations
   * only — index, history, refs, remotes — so source content still changes only through the
   * validated patch proposal and the user's Apply.
   */
  git?: GitAccess;
  /**
   * Analyze the project before and after the patch set. Implemented by the IDE through the
   * browser analyzer worker; a failure here blocks validation (the caller fails closed).
   */
  analyze(
    patches: readonly FilePatch[],
    signal?: AbortSignal,
  ): Promise<{ before: Analysis; after: Analysis }>;
}

/** Raw material the context builder needs beyond the analyzer facts. */
export interface LoadedProjectBase {
  /** Only these sources are read: package.json and tsconfig.json. */
  sources: Readonly<Record<string, string>>;
  /** The /__facilis/manifest envelope's manifest, when the project is running. */
  manifest?: unknown;
  checker: SyntaxChecker | null;
}

/** How long a validation round waits for the live manifest before using the facts alone. */
const MANIFEST_TIMEOUT_MS = 3_000;

/** The only sources the validator parses itself; everything else is analyzer facts. */
const CONTEXT_SOURCES = ["package.json", "tsconfig.json"];

export async function loadProjectContext(
  host: PatchContextHost,
  signal?: AbortSignal,
): Promise<LoadedProjectBase> {
  const sources: Record<string, string> = {};
  await Promise.all(
    CONTEXT_SOURCES.map(async (path) => {
      const content = await host.read(path).catch(() => "");
      if (content.length > 0) sources[path] = content;
    }),
  );
  let manifest: unknown;
  const base = host.manifestBase();
  if (base !== null) {
    // Best-effort: the rules fall back to the analyzer facts when the project is booting,
    // and a validation round must never hang the chat on an unresponsive preview.
    const timeout = AbortSignal.timeout(MANIFEST_TIMEOUT_MS);
    const result = await fetchManifest(base, {
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
    if (result.ok) manifest = result.envelope.manifest;
  }
  return {
    sources,
    ...(manifest === undefined ? {} : { manifest }),
    checker: host.syntaxChecker?.() ?? null,
  };
}
