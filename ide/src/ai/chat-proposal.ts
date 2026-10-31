// Turning parsed patches into the reviewable card the user sees (D-046/D-047).
//
// Pure except for the injected read: the before-image of each update/delete is
// read from the project so the diff is against what is actually on disk, not
// against what the model claimed. The same before-image is what Undo writes back.
// No write happens here.

import type { FilePatch } from "@facilis/ai";
import { fileDiff } from "./diff";
import { scanPatchWarnings } from "./patch-warnings";
import type { ChatProposal, ProposedFile } from "./types";

/** Read a project-relative file; "" when it does not exist. */
export type FileReader = (path: string) => Promise<string>;

export async function buildProposal(
  patches: readonly FilePatch[],
  notes: readonly string[],
  requiresConfirmation: boolean,
  read: FileReader,
): Promise<ChatProposal> {
  const files: ProposedFile[] = [];
  for (const patch of patches) {
    const current = patch.action === "create" ? "" : await read(patch.path);
    // "" means "missing" to the reader; a missing file has no before-image, which
    // still diffs as a creation and makes Undo delete the file again.
    const before = current === "" ? null : current;
    const after = patch.action === "delete" ? null : (patch.content ?? "");
    const diff = fileDiff(before, after);
    files.push({
      patch,
      before,
      added: diff.added,
      removed: diff.removed,
      diff: diff.lines,
      accepted: true,
    });
  }
  return {
    files,
    notes: [...notes],
    requiresConfirmation,
    warnings: scanPatchWarnings(patches),
  };
}
