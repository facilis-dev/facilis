// Parser for the model's single AIResponse object (SPEC §9.2; types.ts AiResponse).
//
// A provider answer is untrusted text: it may carry prose, a markdown fence, unknown keys
// or a patch that would escape the project. This module is the only place that turns that
// text into the typed shape, so the UI never has to defend against it. Patch content is
// checked here only structurally; @facilis/ai's validatePatch owns the safety rules.

import { validatePatch, type FilePatch, type ValidationResult } from "@facilis/ai";
import type { AiResponse } from "./types";

export type AiParseResult =
  | { ok: true; response: AiResponse; validation: ValidationResult }
  | {
      ok: false;
      kind: "empty" | "json" | "contract" | "validation";
      error: string;
      issues: string[];
      raw: string;
    };

type ParseFailure = Extract<AiParseResult, { ok: false }>;

function failure(
  kind: ParseFailure["kind"],
  error: string,
  issues: string[],
  raw: string,
): ParseFailure {
  return { ok: false, kind, error, issues, raw };
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

  if (issues.length > 0) {
    return failure("contract", "The response does not match the AIResponse contract.", issues, raw);
  }

  const validation = validatePatch(parsedPatches.patches);
  if (!validation.ok) {
    return failure(
      "validation",
      "The proposed patches failed validation.",
      validation.errors.map((error) => `${error.rule}: ${error.file}: ${error.message}`),
      raw,
    );
  }

  return {
    ok: true,
    response: {
      message,
      patches: parsedPatches.patches,
      notes: parsedNotes.notes,
      requiresConfirmation,
    },
    validation,
  };
}
