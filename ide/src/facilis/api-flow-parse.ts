// Narrowing for `/_openapi.json` (SPEC §6.9, §10.2). Kept apart from
// api-flow-client.ts (which owns transport) so each file stays well under the
// 300-line limit. Malformed operations are skipped, never guessed.

import type { ApiFlowData, ApiFlowWarning, ApiMethod, ApiOperation } from "./api-flow-client";

const METHODS: readonly ApiMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMethod(value: string): value is ApiMethod {
  return (METHODS as readonly string[]).includes(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    strings.push(entry);
  }
  return strings;
}

function readPermission(value: unknown): string[] {
  const scalar = readString(value);
  if (scalar !== null) return [scalar];
  return readStringArray(value) ?? [];
}

function readWarnings(
  value: unknown,
  route?: { method: ApiMethod; path: string },
): ApiFlowWarning[] {
  if (value === undefined || value === null) return [];
  const entries = Array.isArray(value) ? value : [value];
  const warnings: ApiFlowWarning[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const message = readString(entry["message"]);
    if (message === null) continue;
    const warning: ApiFlowWarning = { message };
    const code = readString(entry["code"]);
    if (code !== null) warning.code = code;
    if (route !== undefined) {
      warning.method = route.method;
      warning.path = route.path;
    }
    warnings.push(warning);
  }
  return warnings;
}

/**
 * One path item entry. OpenAPI keys operations by lower-case method; anything else on
 * the path item (`parameters`, `servers`, `$ref`) is not an operation and is skipped.
 */
function parseOperation(path: string, methodKey: string, value: unknown): ApiOperation | null {
  if (!isRecord(value)) return null;
  const method = methodKey.toUpperCase();
  if (!isMethod(method)) return null;
  return {
    method,
    path,
    summary: readString(value["summary"]),
    description: readString(value["description"]),
    permission: readPermission(value["x-permission"]),
    dbTables: readStringArray(value["x-db-tables"]) ?? [],
    dbColumns: readStringArray(value["x-db-columns"]) ?? [],
    sourceFile: readString(value["x-facilis-source"]),
    warnings: readWarnings(value["x-facilis-warning"], { method, path }),
  };
}

/** Narrow the facade body, or null when it is not an OpenAPI document. */
export function parseOpenApi(value: unknown): ApiFlowData | null {
  if (!isRecord(value)) return null;
  const paths = value["paths"];
  if (!isRecord(paths)) return null;
  const operations: ApiOperation[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (path.length === 0 || !isRecord(item)) continue;
    for (const [methodKey, operation] of Object.entries(item)) {
      const parsed = parseOperation(path, methodKey, operation);
      if (parsed !== null) operations.push(parsed);
    }
  }
  return { operations, warnings: readWarnings(value["x-facilis-warning"]) };
}
