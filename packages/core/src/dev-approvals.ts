/**
 * The dev database's consent file (D-193): `<project>/.facilis/dev/schema-approvals.json`.
 *
 * In dev the runtime reconciles the declared schema onto the live PGlite database, but it
 * never runs destructive DDL on its own: a drop is applied only when the user confirmed that
 * exact change from the IDE, which records it here as rule 15's own wording (`drops table
 * "x"`, `drops column "x.y"`). Naming the change instead of hashing the schema file keeps an
 * approval valid after an unrelated schema edit, and makes it impossible to replay one
 * confirmation against a different table or column.
 *
 * The file is IDE/dev state under `.facilis` (D-052), never source and never committed.
 */

/** Project-relative path of the approvals file. */
export const SCHEMA_APPROVALS_PATH = ".facilis/dev/schema-approvals.json";

/** The approved changes in the file, or an empty list when it is missing or unreadable. */
export function parseSchemaApprovals(json: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const approved = (parsed as { approved?: unknown }).approved;
  if (!Array.isArray(approved)) return [];
  return approved.filter((entry): entry is string => typeof entry === "string");
}

/** The file body for a set of approvals; order is stable so the file only grows. */
export function schemaApprovalsJson(changes: readonly string[]): string {
  return JSON.stringify({ approved: [...new Set(changes)] }, null, 2) + "\n";
}
