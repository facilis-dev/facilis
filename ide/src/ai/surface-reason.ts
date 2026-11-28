// Rewriting a surface declaration's reason after the user edits it (D-226, #234).
//
// The confirmation card prefills the generated reason and the user may reword it. The edit is
// a textual replacement on the exact content the model produced — never a re-serialization —
// so the file that lands is the model's, with one literal changed. A site the helper cannot
// identify unambiguously keeps its original reason: a generic reason is recoverable, malformed
// code is not, and the write must never fail because of a wording edit.

import type { FilePatch, SurfaceRequest } from "@facilis.dev/ai";

/** The stable key the card and the resume path exchange edited reasons under. */
export function surfaceRequestKey(request: SurfaceRequest): string {
  return request.path + ":" + request.line + ":" + request.capability;
}

/** `reason: "..."` in an object literal (single or double quoted, no line break). */
const REASON_FIELD = /reason\s*:\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/;
const REASON_FIELD_ALL = new RegExp(REASON_FIELD.source, "g");
/** `// dynamic-code: <reason>` — the marker form of a dynamic-code declaration. */
const DYNAMIC_MARKER = /(\/\/\s*dynamic-code\s*:\s*)(\S.*?)\s*$/;

function literalValue(literal: string): string {
  const body = literal.slice(1, -1);
  if (!literal.startsWith('"')) return body.replace(/\\(['\\])/g, "$1");
  try {
    const parsed: unknown = JSON.parse(literal);
    return typeof parsed === "string" ? parsed : body;
  } catch {
    // An unparseable literal is not a value we can match; the site stays untouched.
    return body;
  }
}

/** The declaration reason this row carries, or null when the row is not a declaration site. */
function rowReason(row: string, capability: SurfaceRequest["capability"]): string | null {
  if (capability === "dynamic-code") {
    const marker = DYNAMIC_MARKER.exec(row);
    return marker === null ? null : (marker[2] ?? "");
  }
  const field = REASON_FIELD.exec(row);
  return field === null ? null : literalValue(field[1] ?? "");
}

/** True when the row holds exactly one value this capability's rewrite can target. */
function unambiguous(row: string, capability: SurfaceRequest["capability"]): boolean {
  if (capability === "dynamic-code") {
    // A line comment carries one marker: the start of the line or nothing.
    const marker = DYNAMIC_MARKER.exec(row);
    return marker !== null && (marker.index === 0 || /\s$/.test(row.slice(0, marker.index)));
  }
  return (row.match(REASON_FIELD_ALL) ?? []).length === 1;
}

function rewriteRow(row: string, capability: SurfaceRequest["capability"], reason: string): string {
  if (capability === "dynamic-code") {
    return row.replace(DYNAMIC_MARKER, (_all, prefix: string) => prefix + reason);
  }
  // JSON.stringify gives the escaped double-quoted literal: never build one by hand.
  return row.replace(REASON_FIELD, () => "reason: " + JSON.stringify(reason));
}

/** The row to edit: the declaration's own line first, else the single matching row. */
function targetRow(rows: readonly string[], request: SurfaceRequest): number | null {
  const candidates: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (rowReason(row, request.capability) === request.reason) candidates.push(index);
  }
  const preferred = request.line - 1;
  if (candidates.includes(preferred)) return preferred;
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

/**
 * Rewrite the reasons the user edited onto the patch the card held. Requests for other
 * files, unchanged and ambiguous reasons are ignored; the patch is returned untouched when
 * nothing applies, so the caller can persist it as-is.
 */
export function applySurfaceReasons(
  patch: FilePatch,
  requests: readonly SurfaceRequest[],
  edited: Readonly<Record<string, string>>,
): FilePatch {
  const content = patch.content;
  if (content === undefined || patch.action === "delete") return patch;
  let rows = content.split("\n");
  let changed = false;
  for (const request of requests) {
    if (request.path !== patch.path) continue;
    const reason = (edited[surfaceRequestKey(request)] ?? "").trim();
    if (reason.length === 0 || reason === request.reason) continue;
    const index = targetRow(rows, request);
    if (index === null) continue;
    const row = rows[index];
    if (row === undefined || !unambiguous(row, request.capability)) continue;
    rows = rows.map((entry, at) =>
      at === index ? rewriteRow(entry, request.capability, reason) : entry,
    );
    changed = true;
  }
  return changed ? { ...patch, content: rows.join("\n") } : patch;
}
