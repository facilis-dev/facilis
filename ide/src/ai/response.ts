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

import {
  validatePatch,
  type FilePatch,
  type ValidationError,
  type ValidationResult,
} from "@facilis/ai";
import { validatePatchesWithHost, type PatchValidationHost } from "./patch-validation";
import { MAX_PROGRAM_CHARS } from "./ptc/protocol";
import type { AiResponse } from "./types";

export interface AiParseFailure {
  ok: false;
  kind: "empty" | "json" | "contract" | "validation";
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
  return { ok: false, kind, error, issues, findings, patchedFiles, raw };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAction(value: unknown): value is FilePatch["action"] {
  return value === "create" || value === "update" || value === "delete";
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

interface ParsedPatches {
  patches: FilePatch[];
  issues: string[];
}

function parsePatches(value: unknown): ParsedPatches {
  if (value === undefined) return { patches: [], issues: [] };
  if (!Array.isArray(value)) return { patches: [], issues: ["patches: must be an array"] };

  const patches: FilePatch[] = [];
  const issues: string[] = [];

  value.forEach((item, index) => {
    const label = `patches[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${label}: must be an object`);
      return;
    }

    const path = item.path;
    if (typeof path !== "string" || path.trim().length === 0) {
      issues.push(`${label}.path: must be a non-empty string`);
      return;
    }

    const action = item.action;
    if (!isAction(action)) {
      issues.push(`${label}.action: must be "create", "update" or "delete"`);
      return;
    }

    const content = item.content;
    if (content !== undefined && typeof content !== "string") {
      issues.push(`${label}.content: must be a string when present`);
      return;
    }

    // Missing content is left to validatePatch, which requires it for create/update and
    // allows a delete to omit it.
    const patch: FilePatch = { path, action };
    if (typeof content === "string") patch.content = content;
    patches.push(patch);
  });

  return { patches, issues };
}

function parseNotes(value: unknown): { notes: string[]; issue: string | null } {
  if (value === undefined) return { notes: [], issue: null };
  if (!Array.isArray(value)) return { notes: [], issue: "notes: must be an array" };
  // Tolerant on purpose: notes are advisory, so a stray non-string entry is dropped
  // instead of failing a turn whose patches are valid.
  return {
    notes: value.filter((entry): entry is string => typeof entry === "string"),
    issue: null,
  };
}

function oneLine(error: ValidationError): string {
  return `${error.rule}: ${error.file}: ${error.message}`;
}

export function parseAiResponse(raw: string): AiParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return failure("empty", "The provider returned an empty response.", [], raw);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrap(trimmed));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure("json", message, [], raw);
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
