// The incremental write engine's shared shapes (D-181/D-193): what the engine needs from the
// chat host, the four outcomes a write can produce, and the finding constructors that the
// modules validating, applying and confirming a write all use.
//
// Split out of chat-writes.ts so that module, chat-write-persist.ts and chat-write-confirm.ts
// can share the types without importing each other's logic.

import type { Analysis, FilePatch, SyntaxChecker, ValidationError } from "@facilis.dev/ai";

import type { PatchBridge } from "@/facilis/apply-patch";

import { findingsJson, type PtcJson } from "./ptc/protocol";
import type { ChatGitGateFailure, GitSafety } from "./types";

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

/** The write drops a table or a column: the turn pauses until the user confirms (D-193). */
export interface WriteSchemaConfirmation {
  ok: false;
  path: string;
  /** Rule 15's own wording, e.g. `drops column "todos.title"`. */
  confirmation: { changes: readonly string[] };
}

export type WriteOutcome = WriteSuccess | WriteFindings | WriteGitRefusal | WriteSchemaConfirmation;

export function finding(
  rule: string,
  path: string,
  message: string,
  fixHint: string,
): ValidationError {
  return { rule, severity: "error", file: path, message, fix_hint: fixHint };
}

export function findingsOutcome(
  path: string,
  errors: readonly ValidationError[],
  warnings: readonly ValidationError[] = [],
): WriteFindings {
  return { ok: false, path, errors: findingsJson(errors), warnings: findingsJson(warnings) };
}
