// Client for the Entity Explorer (SPEC §11.1): the dev-only live-schema endpoint plus the
// manifest's route metadata (`x-db-tables`/`x-db-columns`, SPEC §6.9).
//
// Same reachability model as manifest-client.ts: the project's in-VM dev server answers
// under the preview-proxy base, every call is throw-free, and the panel renders an
// "unreachable" state instead of taking the editor down with it. The payload narrowing
// lives in data-explorer-parse.ts so this module stays a transport.

import { fetchManifest, manifestBaseUrl } from "./manifest-client";
import { parseRoutes, parseSchemaPayload } from "./data-explorer-parse";

const SCHEMA_PATH = "/__facilis/dev/schema";

export interface ExplorerColumn {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  primaryKey: boolean;
}

export interface ExplorerPolicy {
  name: string;
  command: string;
  restrictive: boolean;
}

/** A table as declared by `db/schema.ts` (the `code` half of the endpoint payload). */
export interface CodeTable {
  name: string;
  /** True when the table carries a tenant/owner scoping column (SPEC §8.4.5). */
  scoped: boolean;
  columns: ExplorerColumn[];
  policies: ExplorerPolicy[];
}

/** A table as read from the running database (the `live` half). */
export interface LiveTable {
  name: string;
  rlsEnabled: boolean;
  columns: ExplorerColumn[];
  policies: ExplorerPolicy[];
}

export type SchemaDriftKind =
  | "table_missing"
  | "table_extra"
  | "column_missing"
  | "column_extra"
  | "column_type"
  | "column_nullability"
  | "rls_disabled"
  | "policy_missing"
  | "policy_extra"
  | "policy_changed";

export interface SchemaDriftEntry {
  kind: SchemaDriftKind;
  table: string;
  column?: string;
  policy?: string;
  expected?: string | null;
  actual?: string | null;
}

export interface ExplorerWarning {
  code?: string;
  message: string;
}

/** One manifest route that references the schema, for the "used by" reverse lookup. */
export interface ExplorerRoute {
  method: string;
  path: string;
  sourceFile: string | null;
  dbTables: string[];
  dbColumns: string[];
}

export interface DataExplorerData {
  codeTables: CodeTable[];
  liveTables: LiveTable[];
  drift: SchemaDriftEntry[];
  warnings: ExplorerWarning[];
  routes: ExplorerRoute[];
}

export type DataExplorerResult =
  | { ok: true; data: DataExplorerData }
  | { ok: false; status: number; error: string; code?: string };

export interface DataExplorerQuery {
  signal?: AbortSignal;
}

function endpoint(baseUrl: string, path: string): string {
  const base = manifestBaseUrl(baseUrl);
  return base.length === 0 ? path : base + path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getJson(
  url: string,
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown; networkError: string | null }> {
  try {
    const response = await fetch(url, { signal });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body, networkError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 0, body: null, networkError: message };
  }
}

async function loadRoutes(baseUrl: string, signal?: AbortSignal): Promise<ExplorerRoute[]> {
  const result = await fetchManifest(baseUrl, { sections: ["routes"], signal });
  if (!result.ok) return [];
  return parseRoutes(result.envelope.manifest["routes"]);
}

/**
 * Fetch the live schema and the manifest routes. Never throws: an unreachable or booting
 * project comes back as ok:false, which is what the panel renders.
 */
export async function fetchDataExplorer(
  baseUrl: string,
  query: DataExplorerQuery = {},
): Promise<DataExplorerResult> {
  const response = await getJson(endpoint(baseUrl, SCHEMA_PATH), query.signal);
  if (response.networkError !== null) {
    return { ok: false, status: 0, error: response.networkError };
  }
  if (response.status !== 200) {
    const code =
      isRecord(response.body) && typeof response.body["code"] === "string"
        ? response.body["code"]
        : undefined;
    return {
      ok: false,
      status: response.status,
      error: "HTTP " + response.status,
      ...(code === undefined ? {} : { code }),
    };
  }
  const payload = parseSchemaPayload(response.body);
  if (payload === null) {
    return { ok: false, status: response.status, error: "invalid schema payload" };
  }
  return { ok: true, data: { ...payload, routes: await loadRoutes(baseUrl, query.signal) } };
}
