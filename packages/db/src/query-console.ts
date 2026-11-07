// Read-only SQL execution and live view creation for the Studio's dev console
// (SPEC §11.2, D-097).
//
// This lives in @facilis/db because it is SQL: AGENTS.md security rule 5 keeps raw Drizzle
// imports inside this package. The Nitro route owns transport and validation; this module
// owns the read-only transaction and the JSON-safe result shape.

import { sql } from "drizzle-orm";

import type { FacilisDb } from "./client.ts";
import { APP_ROLE } from "./policy.ts";
import { isReadOnlySql, stripTrailingSemicolon } from "./read-only-sql.ts";
import { grantViewSelect, ViewDefinitionError, viewDefinitionStatement } from "./views.ts";

export const DEFAULT_QUERY_LIMIT = 100;
export const MAX_QUERY_LIMIT = 500;
/** A console query must not hang the dev server; 5s is generous for a preview. */
export const QUERY_STATEMENT_TIMEOUT_MS = 5000;

export type QueryExecutionErrorCode =
  "invalid_name" | "invalid_sql" | "invalid_permission" | "query_failed" | "create_failed";

/** A console operation the route reports as a 400 `{ code }` body. */
export class QueryExecutionError extends Error {
  readonly code: QueryExecutionErrorCode;

  constructor(code: QueryExecutionErrorCode, message: string) {
    super(message);
    this.name = "QueryExecutionError";
    this.code = code;
  }
}

export interface QueryColumn {
  readonly name: string;
  /** Postgres type name from pg_type (e.g. "uuid", "timestamptz"). */
  readonly pgType: string;
}

export interface QueryExecution {
  readonly columns: readonly QueryColumn[];
  readonly rows: readonly (readonly unknown[])[];
  readonly rowCount: number;
  readonly elapsedMs: number;
  readonly truncated: boolean;
}

interface PgliteField {
  readonly name: string;
  readonly dataTypeID: number;
}

/**
 * Run one read-only statement for the console.
 *
 * The prefix check is the friendly error; the read-only transaction is the boundary: a
 * data-modifying CTE (WITH ... DELETE) passes the prefix check and is rejected by
 * Postgres. The statement is wrapped in an outer LIMIT so a preview cannot stream the
 * whole table into the browser, and a statement timeout keeps a runaway query from
 * pinning the dev server.
 */
export async function runReadOnlyQuery(
  db: FacilisDb,
  sqlText: string,
  limit = DEFAULT_QUERY_LIMIT,
): Promise<QueryExecution> {
  if (!isReadOnlySql(sqlText)) {
    throw new QueryExecutionError(
      "invalid_sql",
      "The console runs one read-only statement (SELECT, WITH, VALUES or TABLE).",
    );
  }
  const statement = stripTrailingSemicolon(sqlText);
  const capped = Math.min(Math.max(Math.trunc(limit), 1), MAX_QUERY_LIMIT);
  const startedAt = performance.now();

  try {
    return await db.db.transaction(async (tx) => {
      await tx.execute(sql.raw("set transaction read only"));
      await tx.execute(
        sql.raw("set local statement_timeout = '" + QUERY_STATEMENT_TIMEOUT_MS + "ms'"),
      );
      const result = await tx.execute(
        sql.raw("select * from (\n" + statement + "\n) as __facilis_query limit " + (capped + 1)),
      );
      const fields = readFields(result);
      if (fields.length === 0) {
        throw new QueryExecutionError("query_failed", "The statement returned no result columns.");
      }
      const types = await readTypeNames(tx, fields);
      const rows = result.rows
        .slice(0, capped)
        .map((row) => fields.map((field) => toJsonValue(row[field.name])));
      return {
        columns: fields.map((field) => ({
          name: field.name,
          pgType: types.get(field.dataTypeID) ?? "unknown",
        })),
        rows,
        rowCount: rows.length,
        elapsedMs: Math.round(performance.now() - startedAt),
        truncated: result.rows.length > capped,
      };
    });
  } catch (error) {
    // Postgres errors are plain driver objects; the console reports the reason as a code,
    // never a 500 with a stack.
    if (error instanceof QueryExecutionError) throw error;
    throw new QueryExecutionError("query_failed", messageOf(error));
  }
}

/**
 * Create (or replace) a live view from the console's SQL and grant the policy role.
 * The Studio writes db/views/<name>.ts afterwards; this call makes the view usable
 * immediately, before the next boot re-applies the code.
 */
export async function createLiveView(
  db: FacilisDb,
  name: string,
  queryText: string,
  permission?: string,
): Promise<void> {
  let statement;
  try {
    statement = viewDefinitionStatement(name, queryText, permission);
  } catch (error) {
    if (error instanceof ViewDefinitionError) {
      throw new QueryExecutionError(error.code, error.message);
    }
    throw error;
  }
  try {
    await db.db.execute(statement);
  } catch (error) {
    throw new QueryExecutionError("create_failed", messageOf(error));
  }
  try {
    await grantViewSelect(db, name);
  } catch (error) {
    throw new QueryExecutionError(
      "create_failed",
      "View created, but the grant to " + APP_ROLE + " failed: " + messageOf(error),
    );
  }
}

async function readTypeNames(
  tx: { execute(query: ReturnType<typeof sql.raw>): Promise<{ rows: Record<string, unknown>[] }> },
  fields: readonly PgliteField[],
): Promise<Map<number, string>> {
  const types = new Map<number, string>();
  const oids = [...new Set(fields.map((field) => field.dataTypeID))].filter((oid) =>
    Number.isInteger(oid),
  );
  if (oids.length === 0) return types;
  const result = await tx.execute(
    sql.raw("select oid, typname from pg_type where oid in (" + oids.join(", ") + ")"),
  );
  for (const row of result.rows) {
    const oid = Number(row["oid"]);
    const name = row["typname"];
    if (Number.isInteger(oid) && typeof name === "string") types.set(oid, name);
  }
  return types;
}

function readFields(result: unknown): PgliteField[] {
  if (typeof result !== "object" || result === null) return [];
  const fields = Reflect.get(result, "fields");
  if (!Array.isArray(fields)) return [];
  const out: PgliteField[] = [];
  for (const entry of fields) {
    if (typeof entry !== "object" || entry === null) continue;
    const name = Reflect.get(entry, "name");
    const oid = Reflect.get(entry, "dataTypeID");
    if (typeof name === "string" && typeof oid === "number") out.push({ name, dataTypeID: oid });
  }
  return out;
}

/**
 * JSON-safe cell value. Postgres drivers hand back bigint, Date, Uint8Array and nested
 * jsonb; JSON.stringify would throw on bigint and silently reshape the rest.
 */
export function toJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return "\\x" + [...value].map(hexByte).join("");
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = toJsonValue(entry);
    return out;
  }
  return String(value);
}

function hexByte(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Drizzle wraps a driver error in "Failed query: …"; the reason (e.g. "cannot execute
  // DELETE in a read-only transaction") is in the cause and is what the console shows.
  const cause = error.cause;
  if (cause instanceof Error && cause.message.length > 0) {
    return error.message + ": " + cause.message;
  }
  return error.message;
}
