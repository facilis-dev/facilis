// Contextual validation before a proposal is shown and before anything is written
// (SPEC §9.3, invariant 9).
//
// Two async steps the pure validator cannot do on its own: assemble the project context
// from the VFS/manifest, and run rule 1 through the injected TypeScript parser. The
// result is a PatchContext the synchronous validatePatch() consumes; errors block the
// caller, warnings never do.

import {
  checkPatchSyntax,
  validatePatch,
  type FilePatch,
  type PatchContext,
  type SyntaxCheck,
  type SyntaxFinding,
  type SyntaxChecker,
  type ValidationResult,
} from "@facilis/ai";
import { loadProjectContext, type PatchContextHost } from "./patch-context";

export type PatchValidationHost = PatchContextHost;

export interface PatchesValidation {
  validation: ValidationResult;
  /** The exact context the rules saw; also the input applyPatch() re-validates with. */
  context: PatchContext;
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
    const findings: SyntaxFinding[] = await checkPatchSyntax(patches, checker);
    return { status: "checked", findings };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", reason };
  }
}

/** Validate a patch set against the live project; the only async step of validation. */
export async function validatePatchesWithHost(
  patches: readonly FilePatch[],
  host: PatchValidationHost,
  options: { requiresConfirmation?: boolean; signal?: AbortSignal } = {},
): Promise<PatchesValidation> {
  const loaded = await loadProjectContext(host, options.signal);
  const syntax = await syntaxCheck(loaded.checker, patches);
  const context: PatchContext = { ...loaded.context, syntax };
  const validation = validatePatch(patches, {
    context,
    ...(options.requiresConfirmation === undefined
      ? {}
      : { requiresConfirmation: options.requiresConfirmation }),
  });
  return { validation, context };
}
