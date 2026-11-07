// Constructive feedback for the SPEC §9.4 retry loop.
//
// A rejected answer is not a dead end: the model gets its own answer back plus a numbered
// findings list (rule, file, message, fix_hint, line/excerpt), the response contract, and
// the current content of the existing files its rejected patch tried to rewrite — without
// that content a whole-file update patch cannot be repaired. Caps keep one repair turn
// bounded; nothing here touches the project.

import type { FilePatch, ValidationError } from "@facilis/ai";
import type { AiParseFailure } from "./response";
import type { AiChatTurn } from "./types";

/** SPEC §9.4: two corrections after the first answer (three model calls at most). */
export const MAX_REPAIR_ATTEMPTS = 2;

const MAX_FINDINGS = 40;
const FILE_CHAR_CAP = 8_000;
const TOTAL_FILE_CHAR_CAP = 24_000;
const RAW_ANSWER_CHAR_CAP = 20_000;

export interface RepairInput {
  failure: AiParseFailure;
  /** 1-based number of the correction being requested. */
  attempt: number;
  max: number;
  /** Read a project-relative file; "" when it does not exist. */
  read: (path: string) => Promise<string>;
}

function cap(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit) + "\n[truncated]";
}

/** The findings as numbered, actionable lines: what is wrong and what to change. */
export function formatFindings(findings: readonly ValidationError[]): string {
  const shown = findings.slice(0, MAX_FINDINGS);
  const lines = shown.map((finding, index) => {
    const where = finding.line === undefined ? finding.file : finding.file + ":" + finding.line;
    const parts = [(index + 1) + ". [" + finding.rule + "] " + where + ": " + finding.message];
    parts.push("   Fix: " + finding.fix_hint);
    if (finding.excerpt !== undefined) parts.push("   At: " + finding.excerpt);
    return parts.join("\n");
  });
  if (findings.length > shown.length) {
    lines.push("(" + (findings.length - shown.length) + " more findings omitted)");
  }
  return lines.join("\n");
}

/** The detail a caller shows for a rejected answer: findings when present, else issues. */
export function formatFailure(failure: AiParseFailure): string {
  if (failure.findings.length > 0) return failure.error + "\n\n" + formatFindings(failure.findings);
  if (failure.issues.length === 0) return failure.error;
  return failure.error + "\n\n" + failure.issues.map((issue) => "- " + issue).join("\n");
}

const CONTRACT = [
  "Return exactly one JSON object and nothing else — no prose, no markdown, no code fence:",
  '{"message": string, "patches": [{"path": string, "action": "create" | "update" | "delete", "content"?: string}], "notes": string[], "requires_confirmation": boolean}',
  "- create and update carry the complete file content; delete omits it.",
  "- Re-emit every existing declaration in a file you rewrite; only add the requested change.",
  "- Do not remove tables, columns, routes, permissions or keys the request did not ask to remove.",
].join("\n");

function report(failure: AiParseFailure, attempt: number, max: number): string {
  const lines = [
    "Your previous answer was rejected before anything was written to the project. This is correction " +
      attempt +
      " of " +
      max +
      ".",
    "Fix every finding below and reply with the complete corrected AIResponse.",
  ];
  if (failure.kind === "validation") {
    lines.push("", "## Validation findings", formatFindings(failure.findings));
  } else {
    lines.push("", "## Why the answer was rejected", failure.error);
    if (failure.issues.length > 0) lines.push(...failure.issues.map((issue) => "- " + issue));
  }
  lines.push("", "## Response contract", CONTRACT);
  return lines.join("\n");
}

interface FileBlock {
  path: string;
  content: string;
}

/** A project-relative path that cannot leave the project root (patch paths are model-authored). */
function isSafeProjectPath(path: string): boolean {
  if (path.trim().length === 0 || path.startsWith("/")) return false;
  return !path.split("/").some((segment) => segment === ".." || segment === ".");
}

/** The current content of the files the rejected patch tried to update, bounded. */
async function currentFiles(
  patches: readonly FilePatch[],
  read: RepairInput["read"],
): Promise<FileBlock[]> {
  const seen = new Set<string>();
  const blocks: FileBlock[] = [];
  let total = 0;
  for (const patch of patches) {
    // A delete keeps its action; there is no base content to re-emit.
    if (patch.action === "delete" || !isSafeProjectPath(patch.path)) continue;
    if (seen.has(patch.path)) continue;
    seen.add(patch.path);
    const content = await read(patch.path);
    if (content.length === 0) continue;
    const room = TOTAL_FILE_CHAR_CAP - total;
    if (room <= 0) break;
    const capped = cap(content, Math.min(FILE_CHAR_CAP, room));
    total += capped.length;
    blocks.push({ path: patch.path, content: capped });
  }
  return blocks;
}

function fileSection(blocks: readonly FileBlock[]): string {
  if (blocks.length === 0) return "";
  const lines = [
    "",
    "## Current content of the files your rejected answer tried to rewrite",
    "Re-emit each complete file with the change applied, preserving every existing line.",
    "A patch with action delete still deletes: omit its content.",
    "",
  ];
  for (const block of blocks) lines.push("### " + block.path, "```", block.content, "```", "");
  return lines.join("\n");
}

/**
 * The turns a correction request adds: the rejected raw answer (so the model sees what it
 * produced) and one user message carrying the findings, the contract and the current files.
 */
export async function buildRepairMessages(input: RepairInput): Promise<AiChatTurn[]> {
  const turns: AiChatTurn[] = [];
  const raw = input.failure.raw.trim();
  if (raw.length > 0) turns.push({ role: "assistant", content: cap(raw, RAW_ANSWER_CHAR_CAP) });
  const files = await currentFiles(input.failure.patchedFiles, input.read);
  turns.push({
    role: "user",
    content: report(input.failure, input.attempt, input.max) + fileSection(files),
  });
  return turns;
}
