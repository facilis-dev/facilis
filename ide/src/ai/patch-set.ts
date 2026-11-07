// Assembly of a patch set that arrives in parts (D-106).
//
// A provider caps an answer at its output limit, so a large change is sent as several
// AIResponse turns: each carries complete files and, except the last, "continue": true. This
// module merges the parts (a later part may correct a file an earlier part sent), builds the
// final answer and writes the turns that ask for the rest. There is no part quota (D-108):
// the loop keeps asking until the model sends a last part. Nothing here touches the project.

import type { FilePatch } from "@facilis/ai";
import type { AiResponse } from "./types";

export interface PatchSetState {
  /** Last patch per path: a later part may correct a file an earlier part sent. */
  patches: Map<string, FilePatch>;
  notes: string[];
  /** OR across parts: a destructive change in any part still needs confirmation. */
  requiresConfirmation: boolean;
  /** The last non-empty message seen: the final part may carry only the tail. */
  message: string;
  /** 1-based number of parts received so far. */
  parts: number;
}

export function emptyPatchSet(): PatchSetState {
  return { patches: new Map(), notes: [], requiresConfirmation: false, message: "", parts: 0 };
}

export function addPatches(set: PatchSetState, response: AiResponse): PatchSetState {
  const patches = new Map(set.patches);
  for (const patch of response.patches) patches.set(patch.path, patch);
  const notes = [...set.notes];
  for (const note of response.notes) {
    if (!notes.includes(note)) notes.push(note);
  }
  return {
    patches,
    notes,
    requiresConfirmation: set.requiresConfirmation || response.requiresConfirmation,
    message: response.message.length > 0 ? response.message : set.message,
    parts: set.parts + 1,
  };
}

/** How many patches introduce a new file or change the stored one: a part of repeats makes no progress. */
export function changedPatches(set: PatchSetState, patches: readonly FilePatch[]): number {
  let changed = 0;
  for (const patch of patches) {
    const current = set.patches.get(patch.path);
    if (
      current === undefined ||
      current.action !== patch.action ||
      current.content !== patch.content
    ) {
      changed += 1;
    }
  }
  return changed;
}

/**
 * Start a correction: the rejected set is kept, so a correction may re-emit only the files
 * it changes (D-106). The part counter starts over for the corrected set.
 */
export function beginCorrection(set: PatchSetState): PatchSetState {
  return { ...set, parts: 0 };
}

/** The complete answer the SPEC §9.3 validator sees: every part's files, one chat message. */
export function completeResponse(set: PatchSetState): AiResponse {
  return {
    message: set.message,
    patches: [...set.patches.values()],
    notes: set.notes,
    requiresConfirmation: set.requiresConfirmation,
  };
}

/** The assistant turn that records what arrived: the raw part can be huge, the list is not. */
export function formatReceived(set: PatchSetState): string {
  const lines = ["Partial patch set received (part " + set.parts + "). Complete patches so far:"];
  for (const patch of set.patches.values()) {
    lines.push("- " + patch.path + " (" + patch.action + ")");
  }
  return lines.join("\n");
}

export interface ContinuationInput {
  set: PatchSetState;
  /** The provider cut the answer at its output limit; its tail never arrived. */
  cutOff?: boolean;
  /** Characters the provider had streamed when it was cut off. */
  cutAt?: number;
  /** Patches that were new or changed in that part; 0 means it only repeated files. */
  changed: number;
}

/** The user turn that asks for the rest of a patch set (D-106). */
export function formatContinuation(input: ContinuationInput): string {
  const lines: string[] = [];
  if (input.cutOff === true) {
    lines.push(
      "Your previous answer was cut off by the provider's output limit after " +
        (input.cutAt ?? 0) +
        " characters. Only the complete patches before the cut arrived, and I kept them.",
    );
  } else {
    lines.push("Your previous answer was one part of the patch set (continue: true).");
  }
  lines.push(
    "",
    formatReceived(input.set),
    "",
    ...(input.changed === 0
      ? [
          "None of the files in that part was new or changed: every one had already been received. Send the files that are still missing.",
          "",
        ]
      : []),
    "## Continue the patch set",
    "- Send the files that are still missing. Send as many complete files as fit in one answer (usually 2-4); never exceed the output limit.",
    '- Set "continue": true while more files remain. The last part omits it; it may carry no patches if every file was already sent, and its message must describe the finished change.',
    "- Do not repeat a file you already sent unless this part corrects it. Before re-emitting a file, read_file it and send its complete content.",
    "- Reply with one JSON object only, in the usual AIResponse shape.",
  );
  return lines.join("\n");
}
