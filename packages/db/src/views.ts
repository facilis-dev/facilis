// Declarative SQL views (D-097/D-098, SPEC §11.2).
//
// A view is code: db/views/*.ts declares it with defineView(), and the framework emits
// CREATE OR REPLACE VIEW at boot (dev); production provisioning is the deploy step's job.
// Two modes (D-098):
// - no permission: security_invoker = true, so the base tables' RLS applies as facilis_app;
// - with a permission: security_invoker = false (definer), and that permission is the only
//   gate — the view is a table-like resource whose access is its declared permission.
// The permission predicate is inlined in the DDL, so its name is validated first.

import { sql, type SQL } from "drizzle-orm";
import {
  PgDialect,
  pgView,
  type ManualViewBuilder,
  type PgColumnBuilderBase,
} from "drizzle-orm/pg-core";

import type { FacilisDb } from "./client.ts";
import { APP_ROLE } from "./policy.ts";
import { isReadOnlySql, stripTrailingSemicolon } from "./read-only-sql.ts";

/** Brand carrier for a view object, so a declaration is recognisable from its export. */
export const VIEW_BRAND: unique symbol = Symbol.for("facilis.db.view");

/** SQL view names are unquoted identifiers; generated code always satisfies this. */
export const VIEW_NAME_PATTERN: RegExp = /^[a-z][a-z0-9_]{0,62}$/;

/** A view's own permission, when declared. Same identifier shape the config uses. */
export const VIEW_PERMISSION_PATTERN: RegExp = /^[a-z][a-z0-9:_-]{0,63}$/;

export interface ViewMetadata {
  readonly name: string;
  readonly query: SQL;
  /** Underlying tables, for manifest/graph metadata. Informational only. */
  readonly tables: readonly string[];
  /** The view's own permission; null keeps the D-097 invoker behaviour (D-098). */
  readonly permission: string | null;
  /** "definer" exactly when a permission is set, "invoker" otherwise. */
  readonly access: "invoker" | "definer";
}

export interface DefineViewOptions<
  TName extends string = string,
  TColumns extends Record<string, PgColumnBuilderBase> = Record<string, PgColumnBuilderBase>,
> {
  /** SQL view name: ^[a-z][a-z0-9_]{0,62}$ */
  readonly name: TName;
  /** Column builders; keys must equal the SQL column names. */
  readonly columns: TColumns;
  /** Literal, read-only SELECT/WITH/VALUES/TABLE. Values must not be interpolated. */
  readonly query: SQL;
  /** Underlying tables the query selects (metadata only). */
  readonly tables?: readonly string[];
  /**
   * Optional view permission (D-098). With it the view becomes a definer view
   * (security_invoker = false) and the declared permission alone decides access; the base
   * tables' permissions are not consulted. Omit it for the D-097 invoker behaviour.
   */
  readonly permission?: string;
}

/** A Drizzle view usable in `db.select().from(...)`, branded with its declaration. */
export type FacilisView<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
> = ReturnType<ManualViewBuilder<TName, TColumns>["existing"]> & {
  readonly [VIEW_BRAND]: ViewMetadata;
};

export type ViewErrorCode = "invalid_name" | "invalid_sql" | "invalid_permission";

/** A declaration that cannot become a database view; the code reaches the dev endpoint. */
export class ViewDefinitionError extends Error {
  readonly code: ViewErrorCode;

  constructor(code: ViewErrorCode, message: string) {
    super(message);
    this.name = "ViewDefinitionError";
    this.code = code;
  }
}

const dialect = new PgDialect();

/**
 * Declare a SQL view. Never throws: an invalid declaration is reported when the framework
 * tries to create it, so a typo in db/views cannot take the dev server down at import time.
 */
export function defineView<
  const TName extends string,
  const TColumns extends Record<string, PgColumnBuilderBase>,
>(options: DefineViewOptions<TName, TColumns>): FacilisView<TName, TColumns> {
  const view = pgView(options.name, options.columns).existing();
  const permission = options.permission ?? null;
  const metadata: ViewMetadata = {
    name: options.name,
    query: options.query,
    tables: options.tables ?? [],
    permission,
    access: permission === null ? "invoker" : "definer",
  };
  Object.defineProperty(view, VIEW_BRAND, { value: metadata, enumerable: false });
  return view as FacilisView<TName, TColumns>;
}

/** The declaration carried by a view object, when `value` is one. */
export function viewMetadata(value: unknown): ViewMetadata | null {
  if (typeof value !== "object" || value === null) return null;
  const metadata: unknown = Reflect.get(value, VIEW_BRAND);
  if (typeof metadata !== "object" || metadata === null) return null;
  const record = metadata as Record<string, unknown>;
  if (typeof record["name"] !== "string") return null;
  if (!isSql(record["query"])) return null;
  const tables = record["tables"];
  const permission = record["permission"];
  const declaredPermission = typeof permission === "string" ? permission : null;
  return {
    name: record["name"],
    query: record["query"],
    tables: Array.isArray(tables)
      ? tables.filter((entry): entry is string => typeof entry === "string")
      : [],
    permission: declaredPermission,
    access: declaredPermission === null ? "invoker" : "definer",
  };
}

export function isFacilisView(value: unknown): boolean {
  return viewMetadata(value) !== null;
}

/**
 * Declarations in one or more module namespaces, deduplicated by name (first wins).
 * A module namespace can export anything, so non-view exports are skipped.
 */
export function collectViewMetadata(
  modules: ReadonlyArray<Record<string, unknown>> | Record<string, unknown>,
): ViewMetadata[] {
  const namespaces = Array.isArray(modules) ? modules : [modules];
  const byName = new Map<string, ViewMetadata>();
  for (const namespace of namespaces) {
    for (const value of Object.values(namespace)) {
      const metadata = viewMetadata(value);
      if (metadata !== null && !byName.has(metadata.name)) byName.set(metadata.name, metadata);
    }
  }
  return [...byName.values()];
}

/**
 * CREATE OR REPLACE VIEW for a declaration. Rejects a non-identifier name and a query
 * that is not a single static read-only statement: the SQL is inlined into the DDL, so
 * this check is the boundary, not a style rule.
 */
export function viewCreateStatement(metadata: ViewMetadata): SQL {
  return viewDefinitionStatement(metadata.name, metadata.query, metadata.permission ?? undefined);
}

/**
 * CREATE OR REPLACE VIEW for a raw SQL text (the query console's create-view flow).
 *
 * With a permission the view is a definer view whose only gate is that permission: the
 * outer wrapper applies it to any query shape, and the permission name is validated before
 * it is inlined (the DDL has no bind parameters, by construction).
 */
export function viewDefinitionStatement(
  name: string,
  query: SQL | string,
  permission?: string,
): SQL {
  if (!VIEW_NAME_PATTERN.test(name)) {
    throw new ViewDefinitionError(
      "invalid_name",
      "A view name must match ^[a-z][a-z0-9_]{0,62}$ (lowercase letters, digits, underscore).",
    );
  }
  if (permission !== undefined && !VIEW_PERMISSION_PATTERN.test(permission)) {
    throw new ViewDefinitionError(
      "invalid_permission",
      "A view permission must match ^[a-z][a-z0-9:_-]{0,63}$ (lowercase letters, digits, :, _, -).",
    );
  }
  const text =
    typeof query === "string" ? stripTrailingSemicolon(query) : compileStaticQuery(query);
  if (!isReadOnlySql(text)) {
    throw new ViewDefinitionError(
      "invalid_sql",
      "A view query must be one static read-only statement (SELECT, WITH, VALUES or TABLE).",
    );
  }
  if (permission === undefined) {
    return sql`create or replace view ${sql.identifier(name)} with (security_invoker = true) as ${sql.raw(text)}`;
  }
  return sql`create or replace view ${sql.identifier(name)} with (security_invoker = false) as select * from (${sql.raw(text)}) as "q" where nullif(current_setting('app.permissions', true), '')::jsonb ? ${sql.raw(`'${permission}'`)}`;
}

/** Grants SELECT on a view to the policy-scoped app role. Idempotent. */
export async function grantViewSelect(db: FacilisDb, name: string): Promise<void> {
  await db.db.execute(sql`grant select on ${sql.identifier(name)} to ${sql.identifier(APP_ROLE)}`);
}

export interface ViewApplyFailure {
  readonly name: string;
  readonly error: string;
}

export interface ViewApplyResult {
  readonly created: readonly string[];
  readonly failed: readonly ViewApplyFailure[];
}

export interface ViewApplyOptions {
  /** Permissions declared in facilis.config.ts; a view naming another one fails as data. */
  readonly permissions?: readonly string[];
}

/**
 * Creates every declared view, then retries the failures once: a view may select from
 * another view declared later in the same module. A failure is data, never a throw, so a
 * broken view degrades to a manifest warning like every other boot step.
 */
export async function applyViews(
  db: FacilisDb,
  modules: ReadonlyArray<Record<string, unknown>> | Record<string, unknown>,
  options: ViewApplyOptions = {},
): Promise<ViewApplyResult> {
  const definitions = collectViewMetadata(modules);
  const declared = options.permissions === undefined ? null : new Set(options.permissions);
  const created: string[] = [];
  const failures = new Map<string, string>();
  // An undeclared permission is a boot warning (view_failed), never a silent grant.
  const allowed = definitions.filter((definition) => {
    if (definition.permission === null || declared === null) return true;
    if (declared.has(definition.permission)) return true;
    failures.set(
      definition.name,
      `permission "${definition.permission}" is not declared in facilis.config.ts auth.permissions`,
    );
    return false;
  });
  let pending: readonly ViewMetadata[] = allowed;

  for (let pass = 0; pass < 2 && pending.length > 0; pass += 1) {
    const retry: ViewMetadata[] = [];
    for (const definition of pending) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- view creation is ordered: a view may select from one created earlier in this pass.
        await db.db.execute(viewCreateStatement(definition));
        // oxlint-disable-next-line no-await-in-loop -- the grant needs the view to exist; keep it right after its create.
        await grantViewSelect(db, definition.name);
        failures.delete(definition.name);
        created.push(definition.name);
      } catch (error) {
        retry.push(definition);
        failures.set(definition.name, messageOf(error));
      }
    }
    pending = pass === 0 ? retry : [];
  }

  return {
    created,
    failed: [...failures].map(([name, error]) => ({ name, error })),
  };
}

/** Compile a literal SQL object and reject interpolated values (DDL has no parameters). */
function compileStaticQuery(query: SQL): string {
  const compiled = dialect.sqlToQuery(query);
  if (compiled.params.length > 0) {
    throw new ViewDefinitionError(
      "invalid_sql",
      "A view query must be static: values cannot be interpolated into it.",
    );
  }
  return stripTrailingSemicolon(compiled.sql);
}

function isSql(value: unknown): value is SQL {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { queryChunks?: unknown }).queryChunks)
  );
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
