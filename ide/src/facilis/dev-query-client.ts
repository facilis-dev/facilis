// Client for the Data Explorer's SQL console (D-097): POST /__facilis/dev/query runs
// one statement and returns JSON-safe rows; POST /__facilis/dev/view turns the same query
// into a reusable `defineView` in the project's database.
//
// Same transport model as data-explorer-client.ts: built from devBase()/devEndpointUrl()
// so the kernel token survives and the request works from a separately opened preview tab,
// and deliberately throw-free so the panel renders a state instead of crashing.

import { devEndpointUrl } from "./dev-base";

const QUERY_PATH = "/__facilis/dev/query";
const VIEW_PATH = "/__facilis/dev/view";

export interface DevQueryColumn {
  name: string;
  /** The Postgres type name, shown next to the column and mapped by view-codegen. */
  pgType: string;
}

/**
 * A cell as the endpoint sends it: JSON-safe scalars plus the nested objects/arrays that
 * `json`/`jsonb` columns produce (the server keeps them as JSON, not strings).
 */
export type DevQueryValue =
  string | number | boolean | null | DevQueryValue[] | { [key: string]: DevQueryValue };

export interface DevQueryData {
  columns: DevQueryColumn[];
  rows: DevQueryValue[][];
  rowCount: number;
  elapsedMs: number;
  truncated: boolean;
}

/** A failed dev call. `code` is the endpoint's machine code when it sends one. */
export interface DevQueryFailure {
  status: number;
  error: string;
  code?: string;
  /** The endpoint's human-readable detail, when it sends one. */
  message?: string;
}

export type DevQueryResult = { ok: true; data: DevQueryData } | ({ ok: false } & DevQueryFailure);
export type DevViewResult = { ok: true; name: string } | ({ ok: false } & DevQueryFailure);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValue(value: unknown): value is DevQueryValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isValue);
  if (isRecord(value)) return Object.values(value).every(isValue);
  return false;
}

function parseColumns(value: unknown): DevQueryColumn[] | null {
  if (!Array.isArray(value)) return null;
  const columns: DevQueryColumn[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.pgType !== "string") {
      return null;
    }
    columns.push({ name: entry.name, pgType: entry.pgType });
  }
  return columns;
}

export function parseDevQueryData(value: unknown): DevQueryData | null {
  if (!isRecord(value)) return null;
  const columns = parseColumns(value.columns);
  if (columns === null) return null;
  if (!Array.isArray(value.rows)) return null;
  const rows: DevQueryValue[][] = [];
  for (const entry of value.rows) {
    if (!Array.isArray(entry) || entry.length !== columns.length) return null;
    const row: DevQueryValue[] = [];
    for (const cell of entry) {
      if (!isValue(cell)) return null;
      row.push(cell);
    }
    rows.push(row);
  }
  if (
    typeof value.rowCount !== "number" ||
    typeof value.elapsedMs !== "number" ||
    typeof value.truncated !== "boolean"
  ) {
    return null;
  }
  return {
    columns,
    rows,
    rowCount: value.rowCount,
    elapsedMs: value.elapsedMs,
    truncated: value.truncated,
  };
}

function errorCode(body: unknown): string | undefined {
  return isRecord(body) && typeof body.code === "string" ? body.code : undefined;
}

function errorMessage(body: unknown): string | undefined {
  return isRecord(body) && typeof body.message === "string" ? body.message : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function postJson(
  url: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown; networkError: string | null }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body, networkError: null };
  } catch (error) {
    return { status: 0, body: null, networkError: errorText(error) };
  }
}

function failure(response: { status: number; body: unknown; networkError: string | null }): {
  status: number;
  error: string;
  code?: string;
  message?: string;
} {
  if (response.networkError !== null) {
    return { status: 0, error: response.networkError };
  }
  const code = errorCode(response.body);
  const message = errorMessage(response.body);
  return {
    status: response.status,
    error: "HTTP " + response.status,
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
  };
}

/** Run one SQL statement as the developer. Never throws. */
export async function runDevQuery(
  base: string,
  sql: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<DevQueryResult> {
  const payload: Record<string, unknown> = { sql };
  if (options.limit !== undefined) payload.limit = options.limit;
  const response = await postJson(devEndpointUrl(base, QUERY_PATH), payload, options.signal);
  if (response.networkError === null && response.status === 200) {
    const data = parseDevQueryData(response.body);
    if (data !== null) return { ok: true, data };
    return { ok: false, status: response.status, error: "invalid query payload" };
  }
  return { ok: false, ...failure(response) };
}

export interface CreateViewOptions {
  /** A declared permission makes the view definer-gated; absent/null keeps the invoker form. */
  readonly permission?: string | null;
  readonly signal?: AbortSignal;
}

/** Create a live view from the query. The code file is written by the caller on success. */
export async function createDevView(
  base: string,
  name: string,
  sql: string,
  options: CreateViewOptions = {},
): Promise<DevViewResult> {
  const payload: Record<string, unknown> = { name, sql };
  if (options.permission !== undefined && options.permission !== null) {
    payload.permission = options.permission;
  }
  const response = await postJson(devEndpointUrl(base, VIEW_PATH), payload, options.signal);
  if (response.networkError === null && response.status === 200) {
    if (isRecord(response.body) && typeof response.body.name === "string") {
      return { ok: true, name: response.body.name };
    }
    return { ok: false, status: response.status, error: "invalid create-view payload" };
  }
  return { ok: false, ...failure(response) };
}
