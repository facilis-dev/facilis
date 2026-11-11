// Dev-only SQL console + live view creation: transport parsing for the two dev routes
// (SPEC §11.2, D-097). The SQL itself lives in @facilis.dev/db (security rule 5); this module
// narrows the request bodies and maps database failures to the route's 400 codes.

import {
  createLiveView,
  QueryExecutionError,
  runReadOnlyQuery,
  type FacilisDb,
  type QueryExecution,
} from "@facilis.dev/db";

export const DEFAULT_QUERY_LIMIT = 100;
export const MAX_QUERY_LIMIT = 500;

export type DevQueryErrorCode =
  | "invalid_body"
  | "invalid_name"
  | "invalid_sql"
  | "invalid_permission"
  | "query_failed"
  | "create_failed";

/** A request the console can render; the code is the body's `code` field. */
export class DevQueryError extends Error {
  readonly code: DevQueryErrorCode;

  constructor(code: DevQueryErrorCode, message: string) {
    super(message);
    this.name = "DevQueryError";
    this.code = code;
  }
}

export interface QueryRequest {
  readonly sql: string;
  readonly limit: number;
}

export interface ViewRequest {
  readonly name: string;
  readonly sql: string;
  /** The view's own permission (D-098); null keeps the invoker form. */
  readonly permission: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLimit(value: unknown): number | null {
  if (value === undefined) return DEFAULT_QUERY_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null;
  return Math.min(value, MAX_QUERY_LIMIT);
}

/** Narrow the console body, or a typed error whose code the route returns as-is. */
export function parseQueryBody(
  body: unknown,
): { ok: true; request: QueryRequest } | { ok: false; error: DevQueryError } {
  if (!isRecord(body)) return { ok: false, error: invalidBody("Expected a JSON object body.") };
  const sqlText = body["sql"];
  if (typeof sqlText !== "string" || sqlText.trim().length === 0) {
    return { ok: false, error: invalidBody('"sql" must be a non-empty string.') };
  }
  const limit = readLimit(body["limit"]);
  if (limit === null) {
    return { ok: false, error: invalidBody('"limit" must be a positive integer.') };
  }
  return { ok: true, request: { sql: sqlText, limit } };
}

export function parseViewBody(
  body: unknown,
): { ok: true; request: ViewRequest } | { ok: false; error: DevQueryError } {
  if (!isRecord(body)) return { ok: false, error: invalidBody("Expected a JSON object body.") };
  const name = body["name"];
  const sqlText = body["sql"];
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, error: invalidBody('"name" must be a non-empty string.') };
  }
  if (typeof sqlText !== "string" || sqlText.trim().length === 0) {
    return { ok: false, error: invalidBody('"sql" must be a non-empty string.') };
  }
  const permission = body["permission"];
  if (
    permission !== undefined &&
    permission !== null &&
    (typeof permission !== "string" || permission.length === 0)
  ) {
    return { ok: false, error: invalidBody('"permission" must be a non-empty string.') };
  }
  return {
    ok: true,
    request: { name, sql: sqlText, permission: typeof permission === "string" ? permission : null },
  };
}

/** Execute a parsed query, mapping the database's codes onto the route's codes. */
export async function runQuery(db: FacilisDb, request: QueryRequest): Promise<QueryExecution> {
  try {
    return await runReadOnlyQuery(db, request.sql, request.limit);
  } catch (error) {
    throw toDevError(error);
  }
}

/** Create a live view from a parsed request, mapping declaration/database failures. */
export async function createView(db: FacilisDb, request: ViewRequest): Promise<void> {
  try {
    await createLiveView(db, request.name, request.sql, request.permission ?? undefined);
  } catch (error) {
    throw toDevError(error);
  }
}

function toDevError(error: unknown): unknown {
  if (error instanceof QueryExecutionError) return new DevQueryError(error.code, error.message);
  return error;
}

function invalidBody(message: string): DevQueryError {
  return new DevQueryError("invalid_body", message);
}
