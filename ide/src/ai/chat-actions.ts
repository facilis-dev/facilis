// Writing a reviewed proposal, and undoing a clean apply (D-046/D-047).
//
// Both directions go through applyPatch(), the validated VFS write path; this
// module only turns a proposal (or its stored before-images) into patches and
// maps the result to what the card shows. Splitting it from ChatSession keeps the
// session under the 300-line limit and makes the undo plan unit-testable.

import type { FilePatch } from "@facilis/ai";
import { applyPatch, type PatchBridge } from "@/facilis/apply-patch";
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

function appliedOf(
  kind: ChatApplied["kind"],
  result: Awaited<ReturnType<typeof applyPatch>>,
): ChatApplied {
  return {
    kind,
    ok: result.ok,
    written: result.written,
    deleted: result.deleted,
    errors: result.errors,
    revision: result.revision,
  };
}

/** Write the accepted files; returns the undo plan built from what actually landed. */
export async function applyAccepted(
  host: ActionHost,
  proposal: ChatProposal,
): Promise<{ applied: ChatApplied; undo: ChatUndo | null }> {
  const accepted = proposal.files.filter((file) => file.accepted);
  const result = await applyPatch({
    ...request(host),
    patches: accepted.map((file) => file.patch),
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
