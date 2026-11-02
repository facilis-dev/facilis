// Project context for the patch validator (SPEC §9.3 wiring).
//
// The validator needs the project as it is before the write: the file list (import
// resolution), facilis.config.ts, db/schema.ts, locales/en.json, package.json and
// tsconfig.json (aliases), plus the live manifest for routes, blocks and the schema
// snapshot. Reads are best-effort: a missing file is an absent fact, never an exception.
//
// Kept out of chat-session.ts (300-line limit) and out of facilis/ (D-019 ratchet).

import { buildProjectContext, type ProjectContext, type SyntaxChecker } from "@facilis/ai";
import { fetchManifest } from "@/facilis/manifest-client";

/** The slice of ChatHost the contextual validation needs. */
export interface PatchContextHost {
  /** Project-relative paths. */
  files(): readonly string[];
  read(path: string): Promise<string>;
  /** Preview base URL for /__facilis/manifest, or null when nothing runs. */
  manifestBase(): string | null;
  /** Rule 1's parser (Monaco's TypeScript worker in the IDE); null when unavailable. */
  syntaxChecker?(): SyntaxChecker | null;
}

export interface LoadedProjectContext {
  context: ProjectContext;
  checker: SyntaxChecker | null;
}

/** How long a validation round waits for the live manifest before using the sources alone. */
const MANIFEST_TIMEOUT_MS = 3_000;

/** Sources the validator's rules parse; other files only contribute their path. */
const CONTEXT_SOURCES = [
  "facilis.config.ts",
  "db/schema.ts",
  "locales/en.json",
  "package.json",
  "tsconfig.json",
];

export async function loadProjectContext(
  host: PatchContextHost,
  signal?: AbortSignal,
): Promise<LoadedProjectContext> {
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
    // Best-effort: the rules fall back to the source facts when the project is booting,
    // and a validation round must never hang the chat on an unresponsive preview.
    const timeout = AbortSignal.timeout(MANIFEST_TIMEOUT_MS);
    const result = await fetchManifest(base, {
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
    if (result.ok) manifest = result.envelope.manifest;
  }
  const context = buildProjectContext({
    files: host.files(),
    sources,
    ...(manifest === undefined ? {} : { manifest }),
  });
  return { context, checker: host.syntaxChecker?.() ?? null };
}
