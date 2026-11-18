// The IDE's incremental write engine for AI source edits (D-181).
//
// The model writes source one file at a time instead of returning a whole-file patch set:
// every write is validated by the §9.3 rules against the project as THIS turn has rewritten
// it (the overlay), written through applyPatch, and journaled. A clean git tree with HEAD is
// the consent for the turn — the first write gates on it and Undo restores the journal from
// HEAD. Findings are data the model repairs; an analyzer outage ends the turn instead, since
// the model cannot fix the validator's plumbing.
//
// A write that drops a table or a column pauses the turn for the user's confirmation (D-193):
// the tool answers "confirmation required" and writes nothing, the session asks, and only a
// confirmed write is applied and recorded for the dev boot. The engine owns that pending state
// because a second write must not land while the card is open.

import type { FilePatch } from "@facilis.dev/ai";

import { applyPatch } from "@/facilis/apply-patch";

import { applyConfirmedWrite } from "./chat-write-confirm";
import { persistWrite, type PersistDeps } from "./chat-write-persist";
import {
  finding,
  findingsOutcome,
  type ChatWritesHost,
  type WriteOutcome,
} from "./chat-write-types";
import { validatePatchesWithHost } from "./patch-validation";
import { isSafeProjectPath } from "./ptc/policy";
import type { ChatGitGateFailure, ChatTurnWrite } from "./types";

export type {
  ChatWritesHost,
  WriteFindings,
  WriteGitRefusal,
  WriteOutcome,
  WriteSchemaConfirmation,
  WriteSuccess,
} from "./chat-write-types";

/** One tool call cannot stream an unbounded file into the validator. */
export const MAX_WRITE_CHARS = 200_000;

export interface ChatWrites {
  /** Reset the turn: journal, overlay, the gate cache, the confirmation and the outage. */
  beginTurn(): void;
  writeFile(path: string, content: string, signal?: AbortSignal): Promise<WriteOutcome>;
  deleteFile(path: string, signal?: AbortSignal): Promise<WriteOutcome>;
  turnWrites(): readonly ChatTurnWrite[];
  /** The pending gate failure, returned once (the turn loop pauses on it). */
  takeGateFailure(): ChatGitGateFailure | null;
  /** The destructive write waiting for confirmation, or null (the turn loop pauses on it). */
  takeSchemaConfirmation(): { changes: readonly string[] } | null;
  /** The user confirmed: validate and apply the write the turn paused on. */
  applyPending(): Promise<WriteOutcome>;
  /** The validator could not run: the turn must end as an outage, not a repair round. */
  outage(): boolean;
  undoTurn(): Promise<{ ok: boolean; errors: string[] }>;
}

export interface ChatWritesDeps {
  /** Injected by the tests; the kernel-bridge writer in the IDE. */
  apply?: typeof applyPatch;
}

export function createChatWrites(host: ChatWritesHost, deps: ChatWritesDeps = {}): ChatWrites {
  const apply = deps.apply ?? applyPatch;
  let journal: ChatTurnWrite[] = [];
  let overlay: FilePatch[] = [];
  // Cached only after it PASSED: a refused gate is re-checked on retry, once the user has
  // committed and the tree is clean again ("commit and continue").
  let gated = false;
  let gateFailure: ChatGitGateFailure | null = null;
  let validatorOutage = false;
  /** The destructive write the turn paused on; cleared when it is applied or the turn ends. */
  let pendingConfirm: { patch: FilePatch; changes: readonly string[] } | null = null;

  const persistDeps: PersistDeps = {
    bridge: host.bridge,
    apply,
    before: (path) => beforeImage(path),
    manifestBase: () => host.manifestBase(),
    record(entry, patch) {
      journal.push(entry);
      overlay = [...overlay, patch];
    },
  };

  function beginTurn(): void {
    journal = [];
    overlay = [];
    gated = false;
    gateFailure = null;
    validatorOutage = false;
    pendingConfirm = null;
  }

  /** True when the path exists in the project or was already written this turn. */
  function existsInTurn(path: string): boolean {
    const written = overlay.some((entry) => entry.path === path && entry.action !== "delete");
    return written || host.files().includes(path);
  }

  /** The before-image for the journal's line counts, preferring this turn's overlay. */
  async function beforeImage(path: string): Promise<string | null> {
    const last = overlay.findLast((entry) => entry.path === path);
    if (last !== undefined) return last.action === "delete" ? null : (last.content ?? "");
    if (!host.files().includes(path)) return null;
    try {
      return await host.read(path);
    } catch {
      // An unreadable file still gets its write; the line counts are display-only.
      return null;
    }
  }

  async function commit(
    path: string,
    action: FilePatch["action"],
    content: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<WriteOutcome> {
    // While a confirmation is pending the turn is paused: no other write may land first.
    if (pendingConfirm !== null) {
      return { ok: false, path, confirmation: { changes: pendingConfirm.changes } };
    }
    // The first write needs HEAD plus a clean tree: that checkpoint is the turn's consent.
    if (!gated) {
      const gate = await host.safety.gate();
      if (!gate.ok) {
        gateFailure = gate.failure;
        return { ok: false, path, git: gate.failure };
      }
      gated = true;
    }
    if (!isSafeProjectPath(path)) {
      return findingsOutcome(path, [
        finding(
          "file-path-allowed",
          path,
          "Write paths must be relative to the project root: " + JSON.stringify(path),
          "Use a project-relative path with no leading slash and no '..' or '.' segment.",
        ),
      ]);
    }
    if (content !== undefined && content.length > MAX_WRITE_CHARS) {
      return findingsOutcome(path, [
        finding(
          "file-content-cap",
          path,
          "The content is " +
            content.length +
            " characters; one write carries at most " +
            MAX_WRITE_CHARS +
            ".",
          "Write the file in smaller pieces or keep each write under the cap.",
        ),
      ]);
    }
    const root = host.root();
    if (root === null) {
      return findingsOutcome(path, [
        finding("project-root", path, "No project folder is open.", "Open a project, then retry."),
      ]);
    }
    const patch: FilePatch = { path, action, ...(content === undefined ? {} : { content }) };
    // The overlay is the pre-patch project: earlier write-tool calls this turn are real files.
    const checked = await validatePatchesWithHost([patch], host, {
      requiresConfirmation: true,
      overlay,
      ...(signal === undefined ? {} : { signal }),
    });
    const validation = checked.validation;
    const infrastructure = [...validation.errors, ...validation.warnings].some(
      (entry) => entry.infrastructure === true,
    );
    if (checked.context === null || infrastructure) {
      validatorOutage = true;
      return findingsOutcome(path, validation.errors, validation.warnings);
    }
    if (!validation.ok) return findingsOutcome(path, validation.errors, validation.warnings);
    if (validation.destructive === true) {
      const changes = validation.destructiveChanges ?? [];
      pendingConfirm = { patch, changes };
      return { ok: false, path, confirmation: { changes } };
    }
    return persistWrite(persistDeps, patch, validation, checked.context, root, signal);
  }

  return {
    beginTurn,
    writeFile(path, content, signal) {
      return commit(path, existsInTurn(path) ? "update" : "create", content, signal);
    },
    deleteFile(path, signal) {
      return commit(path, "delete", undefined, signal);
    },
    turnWrites: () => journal,
    takeGateFailure() {
      const failure = gateFailure;
      gateFailure = null;
      return failure;
    },
    takeSchemaConfirmation() {
      return pendingConfirm === null ? null : { changes: pendingConfirm.changes };
    },
    async applyPending() {
      const pending = pendingConfirm;
      if (pending === null) {
        return findingsOutcome("", [
          finding(
            "schema-confirmation",
            "",
            "No destructive write is waiting for confirmation.",
            "Retry the write.",
          ),
        ]);
      }
      pendingConfirm = null;
      return applyConfirmedWrite(
        {
          host,
          overlay: () => overlay,
          persist: persistDeps,
          markOutage: () => {
            validatorOutage = true;
          },
        },
        pending,
      );
    },
    outage: () => validatorOutage,
    async undoTurn() {
      // Only paths the journal actually wrote: a refused call left nothing to restore.
      const paths = [...new Set(journal.map((entry) => entry.path))];
      journal = [];
      overlay = [];
      if (paths.length === 0) return { ok: true, errors: [] };
      return host.safety.restore(paths);
    },
  };
}
