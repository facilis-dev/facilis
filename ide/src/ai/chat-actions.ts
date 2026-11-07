// Writing a reviewed proposal, and undoing a clean apply (D-046/D-047).
//
// Both directions go through applyPatch(), the validated VFS write path; this
// module only turns a proposal (or its stored before-images) into patches and
// maps the result to what the card shows. Apply additionally validates the
// accepted files against the live project context before the write, so an error
// discovered at Apply time blocks the write even if the proposal was built from
// stale context (SPEC §9.3, invariant 9). Undo is never re-validated: restoring a
// before-image must not be blocked by rules the user is trying to roll back.
//
// Splitting it from ChatSession keeps the session under the 300-line limit and
// makes the undo plan unit-testable.

import type { FilePatch, PatchContext } from "@facilis/ai";
import { applyPatch, type PatchBridge } from "@/facilis/apply-patch";
import { validatePatchesWithHost, type PatchValidationHost } from "./patch-validation";
import type { ChatApplied, ChatProposal, ChatUndo } from "./types";

export interface ActionHost {
  bridge: PatchBridge;
  /** Absolute VFS path of the project root. */
  root: string;
  /** Preview base URL, or null when nothing runs. */
  manifestBase: string | null;
}

function request(host: ActionHost) {
  return {
    bridge: host.bridge,
    root: host.root,
    ...(host.manifestBase === null ? {} : { manifestBase: host.manifestBase }),
  };
}

function validationIssues(result: {
  errors: readonly { rule: string; file: string; message: string }[];
}): string[] {
  return result.errors.map((error) => error.rule + ": " + error.file + ": " + error.message);
}

function appliedOf(
  kind: ChatApplied["kind"],
  result: Awaited<ReturnType<typeof applyPatch>>,
): ChatApplied {
  const errors = [...result.errors];
  if (!result.ok && errors.length === 0) errors.push(...validationIssues(result.validation));
  return {
    kind,
    ok: result.ok,
    written: result.written,
    deleted: result.deleted,
    errors,
    revision: result.revision,
  };
}

/** Write the accepted files; returns the undo plan built from what actually landed. */
export async function applyAccepted(
  host: ActionHost,
  proposal: ChatProposal,
  validationHost?: PatchValidationHost,
): Promise<{ applied: ChatApplied; undo: ChatUndo | null }> {
  const accepted = proposal.files.filter((file) => file.accepted);
  const patches = accepted.map((file) => file.patch);
  let context: PatchContext | undefined;
  if (validationHost !== undefined) {
    const checked = await validatePatchesWithHost(patches, validationHost, {
      requiresConfirmation: proposal.requiresConfirmation,
    });
    // A null context means the analyzer was unavailable, which is a blocking result like
    // any validation error: applyPatch must never run without the context (invariant 9).
    if (!checked.validation.ok || checked.context === null) {
      // Nothing was written: report the blocking errors through the same card a failed
      // apply uses, and keep the proposal so the user can fix and retry.
      return {
        applied: {
          kind: "apply",
          ok: false,
          written: [],
          deleted: [],
          errors: validationIssues(checked.validation),
          revision: null,
        },
        undo: null,
      };
    }
    context = checked.context;
  }
  const result = await applyPatch({
    ...request(host),
    patches,
    ...(context === undefined
      ? {}
      : { context, requiresConfirmation: proposal.requiresConfirmation }),
  });
  const before = new Map(accepted.map((file) => [file.patch.path, file.before]));
  // Only the files that landed are undoable: a partial apply must not claim to
  // restore a file it never touched.
  const entries = [...result.written, ...result.deleted].map((path) => ({
    path,
    content: before.get(path) ?? null,
  }));
  return {
    applied: appliedOf("apply", result),
    undo: entries.length > 0 ? { entries } : null,
  };
}

/** Put the applied files back (or delete the ones the patch created). */
export async function applyUndo(host: ActionHost, undo: ChatUndo): Promise<ChatApplied> {
  const patches: FilePatch[] = undo.entries.map((entry) =>
    entry.content === null
      ? { path: entry.path, action: "delete" }
      : { path: entry.path, action: "update", content: entry.content },
  );
  const result = await applyPatch({ ...request(host), patches });
  return appliedOf("undo", result);
}
