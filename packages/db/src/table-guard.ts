/**
 * Runtime enforcement of a route's `dbTables` declaration (D-157).
 *
 * The static analyzer can see a route's queries, but only the wrapper sees every relation
 * the handler actually touches. `guardDatabase` wraps the policy-scoped client in a Proxy:
 * a relation is checked against the declaration before its query builder runs, so an
 * incomplete declaration fails closed instead of querying and auditing whatever it likes.
 *
 * The wrapper never executes a query itself: it forwards fluent calls to the real Drizzle
 * builder and only intercepts the next relation-bearing call. Query builders are thenable,
 * so `then`/`catch`/`finally` are bound to the unwrapped target and awaiting a guarded
 * builder still runs the original query exactly once.
 */

import { Column, Table, ViewBaseConfig, getTableName, getViewName, is, isView } from "drizzle-orm";

import type { PolicyScopedDatabase } from "./policy.ts";

/** Canonical failure codes of the guard; both are 500s in the core error registry. */
export type TableAccessErrorCode = "table_not_declared" | "raw_sql_not_allowed";

/** Thrown before execution when a route reaches outside its declaration. */
export class TableAccessError extends Error {
  readonly code: TableAccessErrorCode;
  /** Server-side context only: the route wrapper never puts it in the response body. */
  readonly relation?: string;

  constructor(code: TableAccessErrorCode, relation?: string) {
    super(
      code === "raw_sql_not_allowed"
        ? "db.execute is not allowed: the route must declare rawSql: true."
        : `Relation "${relation ?? "unknown"}" is not declared in the route's dbTables.`,
    );
    this.name = "TableAccessError";
    this.code = code;
    if (relation !== undefined) this.relation = relation;
  }
}

/** What a route exposes to the guard: its declaration plus the audited-observation hook. */
export interface TableGuardOptions {
  /** The route's `dbTables` (tables and views, SQL names). */
  readonly declared: readonly string[];
  /** `rawSql: true` on the route; only then may `db.execute` run. */
  readonly allowRawSql?: boolean;
  /** Called for every declared relation the handler actually reaches (sudo audit, D-157). */
  readonly onRelation?: (relation: string) => void;
}

/** Calls that take a relation and must be checked before the builder runs. */
const RELATION_METHODS: ReadonlySet<string> = new Set([
  "select",
  "selectDistinct",
  "insert",
  "update",
  "delete",
  "from",
  "join",
  "leftJoin",
  "rightJoin",
  "innerJoin",
  "fullJoin",
  "into",
]);

/** Query-builder promise methods: bound to the real builder, never wrapped as fluent calls. */
const THEN_METHODS: ReadonlySet<string> = new Set(["then", "catch", "finally"]);

/** Runtime table symbols; Drizzle 0.45 omits its `Table.Symbol` from the declarations. */
const TABLE_SYMBOLS = (
  Table as unknown as {
    readonly Symbol: {
      readonly IsAlias: symbol;
      readonly OriginalName: symbol;
    };
  }
).Symbol;

type SurfaceKind = "db" | "query" | "builder" | "relation";

interface GuardState {
  readonly declared: ReadonlySet<string>;
  readonly allowRawSql: boolean;
  readonly onRelation: ((relation: string) => void) | undefined;
  readonly proxies: WeakMap<object, object>;
  readonly targets: WeakMap<object, object>;
  /** Set when an allowed `db.execute` runs; raw SQL has no inspectable relation names. */
  rawSqlUsed: boolean;
}

/**
 * Wraps a policy-scoped client so every relation is checked against `declared` before the
 * query executes. The returned value is the same Drizzle transaction surface.
 */
export function guardDatabase(
  db: PolicyScopedDatabase,
  options: TableGuardOptions,
): PolicyScopedDatabase {
  const state: GuardState = {
    declared: new Set(options.declared),
    allowRawSql: options.allowRawSql === true,
    onRelation: options.onRelation,
    proxies: new WeakMap(),
    targets: new WeakMap(),
    rawSqlUsed: false,
  };
  return wrapSurface(db as object, "db", state) as PolicyScopedDatabase;
}

function wrapSurface(target: object, kind: SurfaceKind, state: GuardState): object {
  const wrapped = state.proxies.get(target);
  if (wrapped !== undefined) return wrapped;
  const proxy = new Proxy(target, createHandler(state, kind));
  state.proxies.set(target, proxy);
  state.targets.set(proxy, target);
  return proxy;
}

function createHandler(state: GuardState, kind: SurfaceKind): ProxyHandler<object> {
  return {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);

      // Awaiting a guarded builder must call the real builder's then/catch/finally.
      if (typeof property === "string" && THEN_METHODS.has(property)) {
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      }

      // The relational API is keyed by relation: validate before handing out the builder.
      if (kind === "db" && property === "query") {
        return isObject(value) ? wrapSurface(value, "query", state) : value;
      }
      if (kind === "query" && typeof property === "string") {
        if (!isObject(value)) return value;
        const relation = relationFromQueryEntry(value) ?? property;
        observe(relation, state);
        return wrapSurface(value, "relation", state);
      }

      // The raw driver escape hatches are exactly the SQL the declaration cannot describe.
      if (
        kind === "db" &&
        !state.allowRawSql &&
        (property === "$client" || property === "session")
      ) {
        throw new TableAccessError("raw_sql_not_allowed");
      }

      if (typeof value !== "function") return value;
      return createMethod(target, property, value as (...args: unknown[]) => unknown, kind, state);
    },
  };
}

function createMethod(
  target: object,
  property: string | symbol,
  method: (...args: unknown[]) => unknown,
  kind: SurfaceKind,
  state: GuardState,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]): unknown => {
    if (kind === "db" && property === "execute") {
      if (!state.allowRawSql) throw new TableAccessError("raw_sql_not_allowed");
      state.rawSqlUsed = true;
    }
    if (kind === "db" && property === "transaction") {
      return runTransaction(target, method, args, state);
    }
    if (typeof property === "string" && RELATION_METHODS.has(property)) {
      for (const arg of args) observeArgument(arg, state);
    }
    const result = Reflect.apply(method, target, unwrapArgs(args, state));
    return wrapResult(result, target, state);
  };
}

/** Runs the callback with a guarded nested transaction; the query itself still executes once. */
function runTransaction(
  target: object,
  method: (...args: unknown[]) => unknown,
  args: unknown[],
  state: GuardState,
): unknown {
  const [callback, ...rest] = args;
  if (typeof callback !== "function") {
    return Reflect.apply(method, target, unwrapArgs(args, state));
  }
  const wrapped = (tx: unknown, ...inner: unknown[]): unknown =>
    (callback as (...callbackArgs: unknown[]) => unknown)(
      isObject(tx) ? wrapSurface(tx, "db", state) : tx,
      ...inner.map((value) => unwrap(value, state)),
    );
  return Reflect.apply(method, target, [wrapped, ...unwrapArgs(rest, state)]);
}

function wrapResult(result: unknown, target: object, state: GuardState): unknown {
  // Drizzle returns `this` from fluent methods: reuse the existing proxy, do not nest.
  if (result === target) return state.proxies.get(target);
  if (isObject(result) && isBuilderLike(result)) return wrapSurface(result, "builder", state);
  return result;
}

/** Thenable query builders plus the pre-`from` select builder, which is not thenable yet. */
function isBuilderLike(value: object): boolean {
  if (isThenable(value)) return true;
  for (const method of RELATION_METHODS) {
    if (typeof (value as Record<string, unknown>)[method] === "function") return true;
  }
  return false;
}

function observeArgument(value: unknown, state: GuardState, seen: Set<object> = new Set()): void {
  if (!isObject(value) || seen.has(value)) return;
  seen.add(value);

  const relation = relationNameOf(value);
  if (relation !== null) {
    observe(relation, state);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) observeArgument(item, state, seen);
    return;
  }
  if (is(value, Column)) {
    observeArgument(value.table, state, seen);
    return;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) observeArgument(item, state, seen);
  }
}

function observe(relation: string, state: GuardState): void {
  if (!state.declared.has(relation)) throw new TableAccessError("table_not_declared", relation);
  state.onRelation?.(relation);
}

/**
 * SQL name of a relation: aliased tables resolve to their original name, and a view is its
 * own relation (D-097/D-098), never its base tables.
 */
function relationNameOf(value: object): string | null {
  if (is(value, Table)) {
    // Drizzle 0.45 exposes the symbol table at runtime but not in its type declarations.
    const symbols = (Table as unknown as { readonly Symbol: typeof TABLE_SYMBOLS }).Symbol;
    const table = value as unknown as Record<symbol, unknown>;
    if (table[symbols.IsAlias] === true) {
      const original = table[symbols.OriginalName];
      if (typeof original === "string" && original.length > 0) return original;
    }
    const name = getTableName(value);
    return typeof name === "string" && name.length > 0 ? name : null;
  }
  if (isView(value)) {
    const config = (value as unknown as Record<symbol, unknown>)[ViewBaseConfig];
    if (isObject(config)) {
      const record = config as Record<string, unknown>;
      const name =
        record["isAlias"] === true ? (record["originalName"] ?? record["name"]) : record["name"];
      if (typeof name === "string" && name.length > 0) return name;
    }
    const name = getViewName(value);
    return typeof name === "string" && name.length > 0 ? name : null;
  }
  return null;
}

function relationFromQueryEntry(value: object): string | null {
  const table = (value as { readonly table?: unknown }).table;
  return isObject(table) ? relationNameOf(table) : null;
}

function unwrap(value: unknown, state: GuardState): unknown {
  return isObject(value) ? (state.targets.get(value) ?? value) : value;
}

function unwrapArgs(args: unknown[], state: GuardState): unknown[] {
  return args.map((value) => unwrap(value, state));
}

function isThenable(value: object): boolean {
  return typeof (value as { readonly then?: unknown }).then === "function";
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
