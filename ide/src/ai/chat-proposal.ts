// Turning parsed patches into the reviewable card the user sees (D-046).
//
// Pure except for the injected read: the before-image of each update/delete is
// read from the project so the diff is against what is actually on disk, not
// against what the model claimed. No write happens here.

import type { FilePatch } from "@facilis/ai";
import { fileDiff } from "./diff";
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
    const before = patch.action === "create" ? null : await read(patch.path);
    const after = patch.action === "delete" ? null : (patch.content ?? "");
    // "" means "missing" to the reader, but an update of a missing file is still a
    // diff from empty, not a create with no before-image.
    const diff = fileDiff(before === "" && patch.action !== "create" ? null : before, after);
    files.push({
      patch,
      added: diff.added,
      removed: diff.removed,
      diff: diff.lines,
      accepted: true,
    });
  }
  return { files, notes: [...notes], requiresConfirmation };
}
