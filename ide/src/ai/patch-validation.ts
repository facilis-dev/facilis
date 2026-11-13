// Contextual validation before a proposal is shown and before anything is written
// (SPEC §9.3, invariant 9; task-10).
//
// The project facts come from the analyzer worker: the host analyzes the project before and
// after the patch set, then this module maps those facts (plus the two source files and the
// live manifest) into the PatchContext the synchronous validatePatch() consumes. If the
// analyzer is unavailable, validation fails closed with a blocking result: a proposal without
// a context must never reach applyPatch().

import {
  buildProjectContext,
  checkPatchSyntax,
  validatePatch,
  type Analysis,
  type FilePatch,
  type PatchContext,
  type ProjectContext,
  type SyntaxCheck,
  type SyntaxChecker,
  type ValidationResult,
  type WritePolicy,
} from "@facilis.dev/ai";
import { aiWritePolicy } from "@/deploy/current";
import { loadProjectContext, type PatchContextHost } from "./patch-context";

export type PatchValidationHost = PatchContextHost;

export interface PatchesValidation {
  validation: ValidationResult;
  /** The exact context the rules saw; null when the project analyzer was unavailable. */
  context: PatchContext | null;
}

/** The blocking finding for "the project could not be analyzed". */
function analyzerUnavailable(reason: string): ValidationResult {
  return {
    ok: false,
    errors: [
      {
        rule: "project-analysis",
        severity: "error",
        file: "<project>",
        message: "The project analyzer is unavailable: " + reason,
        fix_hint:
          "Wait for the project analyzer to load and retry; patches are not validated without it.",
        infrastructure: true,
      },
    ],
    warnings: [],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The project file list after the writes already applied this turn. */
function overlayFiles(files: readonly string[], overlay: readonly FilePatch[]): readonly string[] {
  if (overlay.length === 0) return files;
  const set = new Set(files);
  for (const patch of overlay) {
    if (patch.action === "delete") set.delete(patch.path);
    else set.add(patch.path);
  }
  return [...set];
}

async function syntaxCheck(
  checker: SyntaxChecker | null,
  patches: readonly FilePatch[],
): Promise<SyntaxCheck> {
  if (checker === null) {
    return { status: "unavailable", reason: "the editor's TypeScript service is not available" };
  }
  try {
    // No "aborted" short-circuit: a skipped parse must not look like a clean one.
    const findings = await checkPatchSyntax(patches, checker);
    return { status: "checked", findings };
  } catch (error) {
    return { status: "unavailable", reason: messageOf(error) };
  }
}

interface Analyses {
  before: Analysis;
  after: Analysis;
}

/**
 * Validate a patch set against the live project. Never throws for an analyzer outage (that
 * is a blocking validation result); a cancellation is rethrown so the chat can drop the turn.
 */
export async function validatePatchesWithHost(
  patches: readonly FilePatch[],
  host: PatchValidationHost,
  options: {
    requiresConfirmation?: boolean;
    signal?: AbortSignal;
    /** Rule 11's writable set; defaults to the build's deployment profile (D-167). */
    writePolicy?: WritePolicy;
    /** Writes already applied this turn: the pre-patch project (incremental writes, D-181). */
    overlay?: readonly FilePatch[];
  } = {},
): Promise<PatchesValidation> {
  let analyses: Analyses;
  try {
    analyses = await host.analyze(patches, options.signal, options.overlay);
  } catch (error) {
    if (options.signal?.aborted === true) throw error;
    return { validation: analyzerUnavailable(messageOf(error)), context: null };
  }

  const loaded = await loadProjectContext(host, options.signal);
  const syntax = await syntaxCheck(loaded.checker, patches);
  const project: ProjectContext = buildProjectContext({
    files: overlayFiles(host.files(), options.overlay ?? []),
    sources: loaded.sources,
    ...(loaded.manifest === undefined ? {} : { manifest: loaded.manifest }),
    analysis: analyses.after,
    before: analyses.before,
  });
  const context: PatchContext = { ...project, syntax };
  const validation = validatePatch(patches, {
    context,
    ...(options.requiresConfirmation === undefined
      ? {}
      : { requiresConfirmation: options.requiresConfirmation }),
    writePolicy: options.writePolicy ?? aiWritePolicy,
  });
  return { validation, context };
}
