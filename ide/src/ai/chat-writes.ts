// The IDE's incremental write engine for AI source edits (D-181).
//
// The model writes source one file at a time instead of returning a whole-file patch set:
// every write is validated by the §9.3 rules against the project as THIS turn has rewritten
// it (the overlay), written through applyPatch, and journaled. A clean git tree with HEAD is
// the consent for the turn — the first write gates on it and Undo restores the journal from
// HEAD. Findings are data the model repairs; an analyzer outage ends the turn instead, since
// the model cannot fix the validator's plumbing.

import type { Analysis, FilePatch, SyntaxChecker, ValidationError } from "@facilis.dev/ai";
import { applyPatch, type PatchBridge } from "@/facilis/apply-patch";

import { fileDiff } from "./diff";
import { validatePatchesWithHost } from "./patch-validation";
import { isSafeProjectPath } from "./ptc/policy";
import { findingsJson, type PtcJson } from "./ptc/protocol";
import type { ChatGitGateFailure, ChatTurnWrite, GitSafety } from "./types";

/** One tool call cannot stream an unbounded file into the validator. */
export const MAX_WRITE_CHARS = 200_000;

/** What the engine needs from the chat host; the analyzer and git seams belong to the host. */
export interface ChatWritesHost {
  root(): string | null;
  bridge: PatchBridge;
  manifestBase(): string | null;
  files(): readonly string[];
  read(path: string): Promise<string>;
  /** Rule 1's parser; the real host supplies it, tests may leave it out to fail closed. */
  syntaxChecker?(): SyntaxChecker | null;
  analyze(
    patches: readonly FilePatch[],
    signal?: AbortSignal,
    overlay?: readonly FilePatch[],
  ): Promise<{ before: Analysis; after: Analysis }>;
  safety: GitSafety;
}

/** A write that passed validation and reached the VFS. */
export interface WriteSuccess {
  ok: true;
  path: string;
  action: FilePatch["action"];
  /** UTF-8 bytes written; 0 for a delete. */
  bytes: number;
  /** The validated change drops a table or a column (rule 15's predicate). */
  destructive: boolean;
  added: number;
  removed: number;
}

/** The validator refused the write: the model reads these findings and repairs the call. */
export interface WriteFindings {
  ok: false;
  path: string;
  errors: PtcJson[];
  warnings: PtcJson[];
}

/** The clean-tree gate refused the write; the session pauses for the user's choice. */
export interface WriteGitRefusal {
  ok: false;
  path: string;
  git: ChatGitGateFailure;
}

export type WriteOutcome = WriteSuccess | WriteFindings | WriteGitRefusal;

export interface ChatWrites {
  /** Reset the turn: journal, overlay, the gate cache and the outage can never leak across turns. */
  beginTurn(): void;
  writeFile(path: string, content: string, signal?: AbortSignal): Promise<WriteOutcome>;
  deleteFile(path: string, signal?: AbortSignal): Promise<WriteOutcome>;
  turnWrites(): readonly ChatTurnWrite[];
  /** The pending gate failure, returned once (the turn loop pauses on it). */
  takeGateFailure(): ChatGitGateFailure | null;
  /** The validator could not run: the turn must end as an outage, not a repair round. */
  outage(): boolean;
  undoTurn(): Promise<{ ok: boolean; errors: string[] }>;
}

export interface ChatWritesDeps {
  /** Injected by the tests; the kernel-bridge writer in the IDE. */
  apply?: typeof applyPatch;
}

function finding(rule: string, path: string, message: string, fixHint: string): ValidationError {
  return { rule, severity: "error", file: path, message, fix_hint: fixHint };
}

function findingsOutcome(
  path: string,
  errors: readonly ValidationError[],
  warnings: readonly ValidationError[] = [],
): WriteFindings {
  return { ok: false, path, errors: findingsJson(errors), warnings: findingsJson(warnings) };
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

  function beginTurn(): void {
    journal = [];
    overlay = [];
    gated = false;
    gateFailure = null;
    validatorOutage = false;
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
    const before = await beforeImage(path);
    const manifestBase = host.manifestBase();
    const applied = await apply({
      bridge: host.bridge,
      root,
      patches: [patch],
      context: checked.context,
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
    const destructive = validation.destructive === true;
    const entry: ChatTurnWrite = {
      path,
      action,
      destructive,
      added: diff.added,
      removed: diff.removed,
    };
    journal.push(entry);
    overlay = [...overlay, patch];
    return {
      ok: true,
      path,
      action,
      bytes: content === undefined ? 0 : new TextEncoder().encode(content).length,
      destructive,
      added: diff.added,
      removed: diff.removed,
    };
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
