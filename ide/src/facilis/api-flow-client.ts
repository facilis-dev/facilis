// Client for the API Flow visualizer (SPEC §10.2, §12 Phase 3): the dev-only
// `/_openapi.json` facade `@facilis/nitro` serves over Nitro's enriched document.
//
// Same reachability model as manifest-client.ts: the project's in-VM dev server answers
// under the preview-proxy base, every call is throw-free, and the panel renders an
// "unreachable"/"error" state instead of taking the editor down with it. The payload
// narrowing lives in api-flow-parse.ts so this module stays a transport.

import { manifestBaseUrl } from "./manifest-client";
import { parseOpenApi } from "./api-flow-parse";

const OPENAPI_PATH = "/_openapi.json";

/** HTTP methods a Facilis route file can declare (SPEC §7.3 RouteMeta.method). */
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** One operation of the facade document, with the x-* metadata flattened. */
export interface ApiOperation {
  method: ApiMethod;
  /** OpenAPI-style path, e.g. `/api/todos/{id}`. */
  path: string;
  summary: string | null;
  description: string | null;
  /** `x-permission`, normalized to a list: the extension may be a scalar or an array. */
  permission: string[];
  /** `x-db-tables` (SPEC §6.9). */
  dbTables: string[];
  /** `x-db-columns`, entries shaped `table.column` (SPEC §6.9). */
  dbColumns: string[];
  /** `x-facilis-source` — project-relative file for the editor jump. */
  sourceFile: string | null;
  /** `x-facilis-warning` entries attached to this operation. */
  warnings: ApiFlowWarning[];
}

/** One non-fatal problem the facade or the AST pass reported. */
export interface ApiFlowWarning {
  code?: string;
  message: string;
  /** Set when the warning belongs to a single operation. */
  method?: ApiMethod;
  path?: string;
}

export interface ApiFlowData {
  operations: ApiOperation[];
  warnings: ApiFlowWarning[];
}

export type ApiFlowResult =
  { ok: true; data: ApiFlowData } | { ok: false; status: number; error: string };

export interface ApiFlowQuery {
  signal?: AbortSignal;
}

function endpoint(baseUrl: string): string {
  const base = manifestBaseUrl(baseUrl);
  return base.length === 0 ? OPENAPI_PATH : base + OPENAPI_PATH;
}

/**
 * Fetch the AST-augmented OpenAPI document (SPEC §6.9). Never throws: a booting,
 * unreachable or OpenAPI-disabled project comes back as ok:false or as an empty
 * document with the facade's warnings, which is what the panel renders.
 */
export async function fetchApiFlow(
  baseUrl: string,
  query: ApiFlowQuery = {},
): Promise<ApiFlowResult> {
  let response: Response;
  try {
    response = await fetch(endpoint(baseUrl), { signal: query.signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, error: message };
  }
  if (response.status !== 200) {
    return { ok: false, status: response.status, error: "HTTP " + response.status };
  }
  const body: unknown = await response.json().catch(() => null);
  const parsed = parseOpenApi(body);
  if (parsed === null) {
    return { ok: false, status: response.status, error: "invalid OpenAPI document" };
  }
  return { ok: true, data: parsed };
}
