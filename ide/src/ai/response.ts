// Parser for the model's single AIResponse object (SPEC §9.2; types.ts AiResponse).
//
// A provider answer is untrusted text: it may carry prose, a markdown fence, unknown keys
// or a patch that would escape the project. This module is the only place that turns that
// text into the typed shape, so the UI never has to defend against it. parseAiResponse is
// the context-free structural gate; parseTurn then runs the full SPEC §9.3 validator
// against the project context before a proposal can exist.
//
// A failure keeps the structured findings (rule, file, fix_hint, line, excerpt) and the
// rejected patches, not just the one-line issues: the SPEC §9.4 repair turn feeds those
// back to the model, and the chat shows them under the error.
//
// D-106: an answer the provider cut at its output limit (or that stops mid-JSON) is marked
// `truncated`; the turn loop salvages its complete patches (salvage.ts) and asks for the
// rest instead of reporting a bare JSON error to the user.

import {
  validatePatch,
  type FilePatch,
  type ValidationError,
  type ValidationResult,
} from "@facilis/ai";
import { validatePatchesWithHost, type PatchValidationHost } from "./patch-validation";
import { MAX_PROGRAM_CHARS } from "./ptc/protocol";
import { isRecord, parseNotes, parsePatches } from "./response-shape";
import type { AiResponse } from "./types";

export interface AiParseFailure {
  ok: false;
  kind: "empty" | "json" | "contract" | "validation";
  /** The provider cut the answer off (output limit) or the JSON stops mid-value. */
  truncated: boolean;
  error: string;
  /** One-line structural issues, in the validator's `rule: file: message` form. */
  issues: string[];
  /** Validator findings with `fix_hint` (and `line`/`excerpt`) for the repair turn. */
  findings: ValidationError[];
  /** The patches the rejected answer proposed: the repair turn reads their current files. */
  patchedFiles: FilePatch[];
  raw: string;
}

export type AiParseResult =
  | { ok: true; response: AiResponse; validation: ValidationResult }
  | AiParseFailure;

function failure(
  kind: AiParseFailure["kind"],
  error: string,
  issues: string[],
  raw: string,
  findings: ValidationError[] = [],
  patchedFiles: FilePatch[] = [],
): AiParseFailure {
  return { ok: false, kind, truncated: false, error, issues, findings, patchedFiles, raw };
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

function oneLine(error: ValidationError): string {
  return `${error.rule}: ${error.file}: ${error.message}`;
}

export function parseAiResponse(
  raw: string,
  options: { truncated?: boolean } = {},
): AiParseResult {
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

  const parsedPatches = parsePatches(parsed.patches);
  issues.push(...parsedPatches.issues);

  const parsedNotes = parseNotes(parsed.notes);
  if (parsedNotes.issue !== null) issues.push(parsedNotes.issue);

  // D-106: a patch set too large for one answer arrives in parts, each part but the last
  // flagged with continue: true.
  const rawContinue = parsed.continue;
  let more = false;
  if (rawContinue !== undefined && typeof rawContinue !== "boolean") {
    issues.push("continue: must be a boolean");
  } else if (rawContinue === true) {
    more = true;
  }

  const rawConfirmation = parsed.requires_confirmation;
  if (rawConfirmation !== undefined && typeof rawConfirmation !== "boolean") {
    issues.push("requires_confirmation: must be a boolean");
  }
  const requiresConfirmation = rawConfirmation === true;

  // D-101: a turn is either one exploration program or one patch set, never both.
  const rawScript = parsed.script;
  let script: string | undefined;
  if (rawScript !== undefined) {
    if (typeof rawScript !== "string") issues.push("script: must be a string when present");
    else if (rawScript.trim().length === 0) issues.push("script: must not be empty");
    else if (rawScript.length > MAX_PROGRAM_CHARS)
      issues.push("script: is too long (max " + MAX_PROGRAM_CHARS + " characters)");
    else if (parsedPatches.patches.length > 0)
      issues.push("script: must be the only action in a turn (omit patches)");
    else script = rawScript;
  }

  if (more && parsedPatches.patches.length === 0) {
    issues.push("continue: requires at least one patch");
  }

  if (issues.length > 0) {
    return failure(
      "contract",
      "The response does not match the AIResponse contract.",
      issues,
      raw,
      [],
      parsedPatches.patches,
    );
  }

  const validation = validatePatch(parsedPatches.patches);
  if (!validation.ok) {
    return failure(
      "validation",
      "The proposed patches failed validation.",
      validation.errors.map(oneLine),
      raw,
      validation.errors,
      parsedPatches.patches,
    );
  }

  return {
    ok: true,
    response: {
      message,
      patches: parsedPatches.patches,
      ...(script === undefined ? {} : { script }),
      ...(more ? { continue: true } : {}),
      notes: parsedNotes.notes,
      requiresConfirmation,
    },
    validation,
  };
}

export type ResponseValidation = { ok: true; validation: ValidationResult } | AiParseFailure;

/**
 * Validate an already-parsed answer against the live project (SPEC §9.3). The turn loop
 * uses it on the final answer; `parseTurn` keeps the raw-text convenience. A script turn
 * carries no patches, so it validates to a clean result (the turn loop handles the program).
 */
export async function validateResponse(
  response: AiResponse,
  host: PatchValidationHost,
  options: { signal?: AbortSignal; raw?: string } = {},
): Promise<ResponseValidation> {
  if (response.patches.length === 0) {
    return { ok: true, validation: { ok: true, errors: [], warnings: [] } };
  }
  const checked = await validatePatchesWithHost(response.patches, host, {
    requiresConfirmation: response.requiresConfirmation,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!checked.validation.ok) {
    return failure(
      "validation",
      "The proposed patches failed validation.",
      checked.validation.errors.map(oneLine),
      options.raw ?? "",
      checked.validation.errors,
      response.patches,
    );
  }
  return { ok: true, validation: checked.validation };
}

/**
 * Parse an answer and, when it proposes patches, validate them against the live project
 * (SPEC §9.3). Errors from the context-dependent rules turn the answer into a
 * `validation` failure before any proposal exists; `parseAiResponse` stays the
 * context-free structural gate used by unit tests and by callers with no project.
 */
export async function parseTurn(
  raw: string,
  host: PatchValidationHost,
  options: { signal?: AbortSignal } = {},
): Promise<AiParseResult> {
  const parsed = parseAiResponse(raw);
  if (!parsed.ok || parsed.response.patches.length === 0) return parsed;
  const checked = await validateResponse(parsed.response, host, { ...options, raw });
  if (!checked.ok) return checked;
  return { ...parsed, validation: checked.validation };
}
