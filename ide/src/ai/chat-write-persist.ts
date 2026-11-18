// Applying one validated write (D-181): the kernel VFS call plus the two records that make it
// part of the turn — the journal (Undo and the git-changes footer) and the overlay the
// validator sees for every later write.
//
// Split out of chat-writes.ts so the confirmation path can apply the write it paused on
// through exactly the same code as a normal one.

import type { FilePatch, PatchContext, ValidationResult } from "@facilis.dev/ai";

import { applyPatch } from "@/facilis/apply-patch";

import {
  finding,
  findingsOutcome,
  type ChatWritesHost,
  type WriteOutcome,
} from "./chat-write-types";
import { fileDiff } from "./diff";
import type { ChatTurnWrite } from "./types";

export interface PersistDeps {
  bridge: ChatWritesHost["bridge"];
  /** The kernel-bridge writer; tests inject their own. */
  apply: typeof applyPatch;
  /** Project-relative before-image, preferring the turn overlay; null for a new file. */
  before(path: string): Promise<string | null>;
  /** The preview base URL for the framework revision refresh, when the host has one. */
  manifestBase(): string | null;
  /** Journal the write and extend the overlay. */
  record(entry: ChatTurnWrite, patch: FilePatch): void;
}

export async function persistWrite(
  deps: PersistDeps,
  patch: FilePatch,
  validation: ValidationResult,
  context: PatchContext,
  root: string,
  signal: AbortSignal | undefined,
): Promise<WriteOutcome> {
  const { path } = patch;
  const { action } = patch;
  const content = action === "delete" ? undefined : patch.content;
  const before = await deps.before(path);
  const manifestBase = deps.manifestBase();
  const applied = await deps.apply({
    bridge: deps.bridge,
    root,
    patches: [patch],
    context,
    requiresConfirmation: true,
    ...(manifestBase === null ? {} : { manifestBase }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!applied.ok) {
    const errors =
      applied.errors.length > 0
        ? applied.errors.map((message) =>
            finding(
              "apply-failed",
              path,
              message,
              "The file was not written; retry, or inspect the project before writing again.",
            ),
          )
        : applied.validation.errors;
    return findingsOutcome(path, errors);
  }
  const after = action === "delete" ? null : (content ?? "");
  const diff = fileDiff(before, after);
  const entry: ChatTurnWrite = {
    path,
    action,
    destructive: validation.destructive === true,
    added: diff.added,
    removed: diff.removed,
  };
  deps.record(entry, patch);
  return {
    ok: true,
    path,
    action,
    bytes: content === undefined ? 0 : new TextEncoder().encode(content).length,
    destructive: validation.destructive === true,
    added: diff.added,
    removed: diff.removed,
  };
}
