// Constructive feedback when the model's answer is not a valid AIResponse (D-100/D-102;
// D-192). Source changes no longer travel in the answer, so a repair fixes the JSON shape
// only: the answer is a message (and an optional script), and every file is written with the
// validated write tools inside a program.
//
// The request carries the rejected raw answer (so the model sees what it produced), the
// issues, the output-limit note when the answer was cut, and the response contract.

import { WRITE_CONTRACT } from "./prompt-write";
import type { AiParseFailure } from "./response";
import type { AiChatTurn } from "./types";

const RAW_ANSWER_CHAR_CAP = 20_000;

export interface RepairInput {
  failure: AiParseFailure;
  /** 1-based number of the correction being requested. */
  attempt: number;
}

function cap(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit) + "\n[truncated]";
}

function reasons(failure: AiParseFailure): string {
  if (failure.issues.length === 0) return failure.error;
  return failure.error + "\n\n" + failure.issues.map((issue) => "- " + issue).join("\n");
}

function report(failure: AiParseFailure, attempt: number): string {
  const lines = [
    "Your previous answer was not a valid AIResponse. This is correction attempt " + attempt + ".",
    "Fix what is listed below and reply with the corrected AIResponse.",
    "",
    "## Why the answer was rejected",
    reasons(failure),
  ];
  if (failure.truncated) {
    lines.push(
      "",
      "## The answer was cut off",
      "The provider stopped your answer at its output limit. Keep the answer short: the final answer is a summary, and the files are written with the write tools.",
    );
  }
  lines.push("", "## Response contract", WRITE_CONTRACT);
  return lines.join("\n");
}

/**
 * The turns a correction request adds: the rejected raw answer (so the model sees what it
 * produced) and one user message carrying the reasons and the contract.
 */
export async function buildRepairMessages(input: RepairInput): Promise<AiChatTurn[]> {
  const turns: AiChatTurn[] = [];
  const raw = input.failure.raw.trim();
  if (raw.length > 0) turns.push({ role: "assistant", content: cap(raw, RAW_ANSWER_CHAR_CAP) });
  turns.push({
    role: "user",
    content: report(input.failure, input.attempt),
  });
  return turns;
}
