// Narrowing for the Entity Explorer's endpoint payload and manifest routes. Kept apart
// from data-explorer-client.ts (which owns transport) so each file stays well under the
// 300-line limit.

import type {
  CodeTable,
  DataExplorerData,
  ExplorerColumn,
  ExplorerPolicy,
  ExplorerRoute,
  ExplorerWarning,
  LiveTable,
  SchemaDriftEntry,
  SchemaDriftKind,
} from "./data-explorer-client";

const DRIFT_KINDS: readonly SchemaDriftKind[] = [
  "table_missing",
  "table_extra",
  "column_missing",
  "column_extra",
  "column_type",
  "column_nullability",
  "rls_disabled",
  "policy_missing",
  "policy_extra",
  "policy_changed",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function parseColumn(value: unknown): ExplorerColumn | null {
  if (!isRecord(value)) return null;
  const name = readString(value["name"]);
  if (name === null) return null;
  return {
    name,
    type: readString(value["type"]) ?? "",
    notNull: value["notNull"] === true,
    default: readString(value["default"]),
    primaryKey: value["isPrimaryKey"] === true,
  };
}

function parseColumns(value: unknown): ExplorerColumn[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseColumn).filter((column): column is ExplorerColumn => column !== null);
}

function parsePolicy(value: unknown, live: boolean): ExplorerPolicy | null {
  if (!isRecord(value)) return null;
  const name = readString(value["name"]);
  if (name === null) return null;
  return {
    name,
    command: (readString(value["command"]) ?? "ALL").toUpperCase(),
    // The code snapshot does not model AS RESTRICTIVE separately; its rendered SQL says it.
    restrictive: live
      ? value["restrictive"] === true
      : /\bas\s+restrictive\b/i.test(readString(value["sql"]) ?? ""),
  };
}

function parsePolicies(value: unknown, live: boolean): ExplorerPolicy[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => parsePolicy(entry, live))
    .filter((policy): policy is ExplorerPolicy => policy !== null);
}

function parseCodeTable(value: unknown): CodeTable | null {
  if (!isRecord(value)) return null;
  const name = readString(value["name"]);
  if (name === null) return null;
  return {
    name,
    scoped: isRecord(value["scopeColumn"]),
    columns: parseColumns(value["columns"]),
    policies: parsePolicies(value["policies"], false),
  };
}

function parseLiveTable(value: unknown): LiveTable | null {
  if (!isRecord(value)) return null;
  const name = readString(value["name"]);
  if (name === null) return null;
  return {
    name,
    rlsEnabled: value["rlsEnabled"] === true,
    columns: parseColumns(value["columns"]),
    policies: parsePolicies(value["policies"], true),
  };
}

function parseTableList<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(parse).filter((table): table is T => table !== null);
}

function isDriftKind(value: unknown): value is SchemaDriftKind {
  return typeof value === "string" && (DRIFT_KINDS as readonly string[]).includes(value);
}

function parseDrift(value: unknown): SchemaDriftEntry | null {
  if (!isRecord(value)) return null;
  const kind = value["kind"];
  const table = readString(value["table"]);
  if (!isDriftKind(kind) || table === null) return null;
  const entry: SchemaDriftEntry = { kind, table };
  const column = readString(value["column"]);
  if (column !== null) entry.column = column;
  const policy = readString(value["policy"]);
  if (policy !== null) entry.policy = policy;
  if (value["expected"] !== undefined) entry.expected = readString(value["expected"]);
  if (value["actual"] !== undefined) entry.actual = readString(value["actual"]);
  return entry;
}

function parseWarnings(value: unknown): ExplorerWarning[] {
  if (!Array.isArray(value)) return [];
  const warnings: ExplorerWarning[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const message = readString(entry["message"]);
    if (message === null) continue;
    const warning: ExplorerWarning = { message };
    const code = readString(entry["code"]);
    if (code !== null) warning.code = code;
    warnings.push(warning);
  }
  return warnings;
}

/** Narrow the endpoint body, or null when it is not a schema payload. */
export function parseSchemaPayload(value: unknown): Omit<DataExplorerData, "routes"> | null {
  if (!isRecord(value)) return null;
  const code = isRecord(value["code"]) ? value["code"]["tables"] : undefined;
  const live = isRecord(value["live"]) ? value["live"]["tables"] : undefined;
  if (!Array.isArray(code) || !Array.isArray(live)) return null;
  return {
    codeTables: parseTableList(code, parseCodeTable),
    liveTables: parseTableList(live, parseLiveTable),
    drift: Array.isArray(value["drift"])
      ? value["drift"].map(parseDrift).filter((entry): entry is SchemaDriftEntry => entry !== null)
      : [],
    warnings: parseWarnings(value["warnings"]),
  };
}

/** Read the route metadata out of a manifest (SPEC §6.9); unknown entries are skipped. */
export function parseRoutes(value: unknown): ExplorerRoute[] {
  if (!Array.isArray(value)) return [];
  const routes: ExplorerRoute[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const method = readString(entry["method"]);
    const path = readString(entry["path"]);
    if (method === null || path === null) continue;
    routes.push({
      method,
      path,
      sourceFile: readString(entry["sourceFile"]),
      dbTables: readStringArray(entry["dbTables"]) ?? [],
      dbColumns: readStringArray(entry["dbColumns"]) ?? [],
    });
  }
  return routes;
}
