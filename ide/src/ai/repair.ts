// Constructive feedback for the SPEC §9.4 retry loop (D-100/D-102; PTC-only since D-103).
//
// A rejected answer is not a dead end: the model gets its own answer back plus a fix plan
// grouped by file, root cause first, then numbered findings (rule, file, message, fix_hint,
// line/excerpt) and the response contract. The chat has one mode (PTC, D-103): the correction
// tells the model to read the files itself and to validate the exact set it will return, so no
// file content is inlined. Caps keep one repair turn bounded; nothing here touches the project.

import type { FilePatch, ValidationError } from "@facilis/ai";
import type { AiParseFailure } from "./response";
import type { AiChatTurn } from "./types";

/** SPEC §9.4 (D-102): three corrections after the first answer (four model calls at most). */
export const MAX_REPAIR_ATTEMPTS = 3;

const MAX_FINDINGS = 40;
const RAW_ANSWER_CHAR_CAP = 20_000;

/** Files whose findings usually explain the rest: fix them first. */
const ROOT_CAUSE_FILES = ["db/schema.ts", "facilis.config.ts"];
/** Within the schema, the destructive-change finding is the root cause of the route noise. */
const ROOT_CAUSE_RULES = ["destructive-confirmed", "rls-on-scoped-table"];

export interface RepairInput {
  failure: AiParseFailure;
  /** 1-based number of the correction being requested. */
  attempt: number;
  max: number;
}

function cap(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit) + "\n[truncated]";
}

function fileRank(file: string): number {
  const index = ROOT_CAUSE_FILES.indexOf(file);
  return index === -1 ? ROOT_CAUSE_FILES.length : index;
}

function ruleRank(rule: string): number {
  const index = ROOT_CAUSE_RULES.indexOf(rule);
  return index === -1 ? ROOT_CAUSE_RULES.length : index;
}

/** Stable, root-cause-first ordering: schema/config first, then files alphabetically. */
export function prioritizeFindings(findings: readonly ValidationError[]): ValidationError[] {
  return [...findings].sort((left, right) => {
    const byFile = fileRank(left.file) - fileRank(right.file);
    if (byFile !== 0) return byFile;
    const byRule = ruleRank(left.rule) - ruleRank(right.rule);
    if (byRule !== 0) return byRule;
    return left.file.localeCompare(right.file);
  });
}

/** The findings as numbered, actionable lines: what is wrong and what to change. */
export function formatFindings(findings: readonly ValidationError[]): string {
  const ordered = prioritizeFindings(findings);
  const shown = ordered.slice(0, MAX_FINDINGS);
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

/**
 * A compact per-file plan before the detailed list: it tells the model where to start and
 * which files its rejected answer touched, so one schema fix is not attempted after five
 * route findings that are only consequences of it.
 */
export function formatFixPlan(
  findings: readonly ValidationError[],
  patchedFiles: readonly FilePatch[],
): string {
  const ordered = prioritizeFindings(findings);
  const byFile = new Map<string, ValidationError[]>();
  for (const finding of ordered) {
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }
  const lines = ["## Fix plan (root cause first)"];
  for (const [file, entries] of byFile) {
    const rules = [...new Set(entries.map((entry) => entry.rule))].join(", ");
    lines.push("- " + file + " — " + entries.length + " finding(s): " + rules);
  }
  const roots = [...byFile.keys()].filter((file) => fileRank(file) < ROOT_CAUSE_FILES.length);
  if (roots.length > 0) {
    lines.push(
      "",
      "Fix " +
        roots.join(" and ") +
        " first: several route findings are usually consequences of the same schema/config inconsistency.",
    );
  }
  if (patchedFiles.length > 0) {
    lines.push("", "## Your rejected answer touched");
    for (const patch of patchedFiles) lines.push("- " + patch.path + " (" + patch.action + ")");
  }
  return lines.join("\n");
}

/** The detail a caller shows for a rejected answer: findings when present, else issues. */
export function formatFailure(failure: AiParseFailure): string {
  const lines: string[] = [];
  if (failure.truncated) {
    lines.push(
      "The provider cut the answer at its output limit, so the patch set is incomplete; nothing was written.",
    );
  }
  if (failure.findings.length > 0) {
    lines.push(failure.error + "\n\n" + formatFindings(failure.findings));
  } else if (failure.issues.length === 0) {
    lines.push(failure.error);
  } else {
    lines.push(failure.error + "\n\n" + failure.issues.map((issue) => "- " + issue).join("\n"));
  }
  return lines.join("\n\n");
}

const CONTRACT = [
  "Return exactly one JSON object and nothing else — no prose, no markdown, no code fence:",
  '{"message": string, "patches": [{"path": string, "action": "create" | "update" | "delete", "content"?: string}], "notes": string[], "requires_confirmation": boolean}',
  "- create and update carry the complete file content; delete omits it.",
  "- Re-emit every existing declaration in a file you rewrite; only add the requested change.",
  "- Do not remove tables, columns, routes, permissions or keys the request did not ask to remove.",
  '- If the set would exceed the output limit, split it: at most 2-3 files per answer, "continue": true on every part but the last.',
].join("\n");

function report(failure: AiParseFailure, attempt: number, max: number): string {
  const lines = [
    "Your previous answer was rejected before anything was written to the project. This is correction " +
      attempt +
      " of " +
      max +
      ".",
    "Fix every finding below and reply with the complete corrected AIResponse: it replaces the rejected set, so include every file the set needs (send it in parts if it is large).",
  ];
  if (failure.kind === "validation") {
    lines.push("", formatFixPlan(failure.findings, failure.patchedFiles));
    lines.push("", "## Validation findings", formatFindings(failure.findings));
  } else {
    lines.push("", "## Why the answer was rejected", failure.error);
    if (failure.issues.length > 0) lines.push(...failure.issues.map((issue) => "- " + issue));
  }
  if (failure.truncated) {
    lines.push(
      "",
      "## The answer was cut off",
      "The provider stopped your answer at its output limit, so it arrived as incomplete JSON. The complete patches before the cut were kept. Send the rest in parts: at most 2-3 files per answer, and set \"continue\": true on every part but the last (the last part may carry no patches if every file was already sent).",
    );
  }
  lines.push(
    "",
    "## Tools",
    "Read-only tools are available in a script turn. For every file named above: read_file it before re-emitting it, then call validate on the exact patch set you are about to return.",
    "Fix root causes first: a schema or config fix can clear several route findings.",
    "",
    "## Response contract",
    CONTRACT,
  );
  return lines.join("\n");
}

/**
 * The turns a correction request adds: the rejected raw answer (so the model sees what it
 * produced) and one user message carrying the plan, the findings and the contract.
 */
export async function buildRepairMessages(input: RepairInput): Promise<AiChatTurn[]> {
  const turns: AiChatTurn[] = [];
  const raw = input.failure.raw.trim();
  if (raw.length > 0) turns.push({ role: "assistant", content: cap(raw, RAW_ANSWER_CHAR_CAP) });
  turns.push({
    role: "user",
    content: report(input.failure, input.attempt, input.max),
  });
  return turns;
}
