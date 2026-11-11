// The structural half of the AIResponse parser (SPEC §9.2), split out of response.ts to
// keep both files under the 300-line limit. Nothing here validates against the project:
// these helpers only decide whether an untrusted value is shaped like a patch or a note.

import type { FilePatch } from "@facilis.dev/ai";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAction(value: unknown): value is FilePatch["action"] {
  return value === "create" || value === "update" || value === "delete";
}

export interface ParsedPatches {
  patches: FilePatch[];
  issues: string[];
}

export function parsePatches(value: unknown): ParsedPatches {
  if (value === undefined) return { patches: [], issues: [] };
  if (!Array.isArray(value)) return { patches: [], issues: ["patches: must be an array"] };

  const patches: FilePatch[] = [];
  const issues: string[] = [];

  value.forEach((item, index) => {
    const label = "patches[" + index + "]";
    if (!isRecord(item)) {
      issues.push(label + ": must be an object");
      return;
    }

    const path = item.path;
    if (typeof path !== "string" || path.trim().length === 0) {
      issues.push(label + ".path: must be a non-empty string");
      return;
    }

    const action = item.action;
    if (!isAction(action)) {
      issues.push(label + '.action: must be "create", "update" or "delete"');
      return;
    }

    const content = item.content;
    if (content !== undefined && typeof content !== "string") {
      issues.push(label + ".content: must be a string when present");
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

export function parseNotes(value: unknown): { notes: string[]; issue: string | null } {
  if (value === undefined) return { notes: [], issue: null };
  if (!Array.isArray(value)) return { notes: [], issue: "notes: must be an array" };
  // Tolerant on purpose: notes are advisory, so a stray non-string entry is dropped
  // instead of failing a turn whose patches are valid.
  return {
    notes: value.filter((entry): entry is string => typeof entry === "string"),
    issue: null,
  };
}
