// Parser for the model's single AIResponse object (SPEC §9.2; D-101/D-192).
//
// A provider answer is untrusted text: it may carry prose, a markdown fence, unknown keys or
// an old-style patch set. This module is the only place that turns that text into the typed
// shape, so the UI never has to defend against it. Source changes never travel in the answer —
// the write tools are the only path — so a returned `patches` field is a contract error and
// the repair turn asks the model to write those files instead.
//
// D-106: an answer the provider cut at its output limit is marked `truncated`; the repair turn
// then asks for a short answer (the final answer is a summary, never a patch set).

import { MAX_PROGRAM_CHARS } from "./ptc/protocol";
import type { AiResponse } from "./types";

export interface AiParseFailure {
  ok: false;
  kind: "empty" | "json" | "contract";
  /** The provider cut the answer off (output limit) or the JSON stops mid-value. */
  truncated: boolean;
  error: string;
  /** One-line structural issues, in the validator's `rule: file: message` form. */
  issues: string[];
  raw: string;
}

export type AiParseResult = { ok: true; response: AiResponse } | AiParseFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  kind: AiParseFailure["kind"],
  error: string,
  issues: string[],
  raw: string,
): AiParseFailure {
  return { ok: false, kind, truncated: false, error, issues, raw };
}

/** Strip a surrounding fence if there is one, else peel prose off both ends. */
function unwrap(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}

/**
 * V8 reports a cut answer as an error at the very end of the parsed text; a missing comma
 * or a stray token is reported earlier. The provider's finish reason is the stronger signal,
 * so this is only the fallback when the stream never carried one.
 */
function cutAtEnd(body: string, error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Unexpected end of JSON input")) return true;
  const position = /at position (\d+)/.exec(message);
  return position !== null && Number(position[1]) >= body.length - 1;
}

export function parseAiResponse(raw: string, options: { truncated?: boolean } = {}): AiParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return failure("empty", "The provider returned an empty response.", [], raw);
  }

  const body = unwrap(trimmed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const truncated = options.truncated === true || cutAtEnd(body, error);
    return { ...failure("json", message, [], raw), truncated };
  }

  if (!isRecord(parsed)) {
    return failure(
      "contract",
      "The response must be a JSON object.",
      ["response: must be a JSON object"],
      raw,
    );
  }

  const issues: string[] = [];
  let message = "";
  if (typeof parsed.message === "string") message = parsed.message;
  else issues.push("message: must be a string");

  // D-192: the answer never carries file content. An old-style patch set is rejected with the
  // one instruction that fixes it, instead of being silently ignored.
  if (parsed.patches !== undefined) {
    issues.push(
      "patches: not part of the response; write every file with write_file/delete_file and answer with message (and an optional script)",
    );
  }

  const rawScript = parsed.script;
  let script: string | undefined;
  if (rawScript !== undefined) {
    if (typeof rawScript !== "string") issues.push("script: must be a string when present");
    else if (rawScript.trim().length === 0) issues.push("script: must not be empty");
    else if (rawScript.length > MAX_PROGRAM_CHARS)
      issues.push("script: is too long (max " + MAX_PROGRAM_CHARS + " characters)");
    else script = rawScript;
  }

  if (issues.length > 0) {
    return failure("contract", "The response does not match the AIResponse contract.", issues, raw);
  }

  return {
    ok: true,
    response: {
      message,
      ...(script === undefined ? {} : { script }),
    },
  };
}
