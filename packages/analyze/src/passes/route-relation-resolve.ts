/**
 * Name resolution for the route-relations pass (D-157). Split from route-relations.ts so both
 * files stay under the 300-line limit.
 *
 * Two questions are answered here, without executing project code:
 * - which relation (table or view) an expression denotes, following same-file consts, project
 *   imports, re-exports and namespace members;
 * - which db client an expression denotes, so a use can be attributed to `ctx.db` or to one
 *   audited elevation callback.
 *
 * Anything outside the static subset is explicit: "opaque" means a package binding we cannot
 * inspect (no error, the runtime guard is the authority), "unresolved" means dynamic project
 * code (an error, D-157: route-table-unresolved).
 */

import {
  callArguments,
  identifierName,
  memberName,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import { localInitializer } from "../module-info.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { TableFact, ViewFact } from "../types.ts";
import { findDeclaration } from "./static-read.ts";

export interface DbClient {
  /** Elevation index in RouteRelationsFact.elevations; null is the route's ctx.db. */
  readonly elevation: number | null;
}

export const ROUTE_CLIENT: DbClient = { elevation: null };
export type ClientEnv = ReadonlyMap<string, DbClient>;

export type RelationResolution =
  | { readonly kind: "resolved"; readonly name: string }
  | { readonly kind: "unresolved" }
  | { readonly kind: "opaque" };

const UNRESOLVED: RelationResolution = { kind: "unresolved" };
const OPAQUE: RelationResolution = { kind: "opaque" };

export interface RelationIndex {
  readonly names: ReadonlySet<string>;
  resolve(
    graph: ModuleGraph,
    file: ProjectFile,
    node: AstNode | undefined,
    aliases: ReadonlyMap<string, string>,
    depth?: number,
  ): RelationResolution;
}

interface RelationLookup {
  readonly byBinding: ReadonlyMap<string, string>;
  readonly names: ReadonlySet<string>;
}

/** Table and view bindings, keyed by declaring file + binding (D-157). */
export function createRelationIndex(
  tables: readonly TableFact[],
  views: readonly ViewFact[],
): RelationIndex {
  const byBinding = new Map<string, string>();
  const names = new Set<string>();
  for (const table of tables) {
    names.add(table.name);
    if (table.binding !== null) byBinding.set(table.source.file + "#" + table.binding, table.name);
  }
  for (const view of views) {
    names.add(view.name);
    if (view.binding !== null) byBinding.set(view.source.file + "#" + view.binding, view.name);
  }
  const lookup: RelationLookup = { byBinding, names };
  return {
    names,
    resolve: (graph, file, node, aliases, depth = 0) =>
      resolveRelation(graph, file, node, aliases, lookup, depth),
  };
}

const MAX_RELATION_DEPTH = 8;

function resolveRelation(
  graph: ModuleGraph,
  file: ProjectFile,
  node: AstNode | undefined,
  aliases: ReadonlyMap<string, string>,
  lookup: RelationLookup,
  depth: number,
): RelationResolution {
  const expression = unwrapExpression(node);
  if (expression === undefined || depth > MAX_RELATION_DEPTH) return UNRESOLVED;
  if (expression.type === "Identifier") {
    const local = identifierName(expression);
    if (local === undefined) return UNRESOLVED;
    const alias = aliases.get(local);
    if (alias !== undefined) return { kind: "resolved", name: alias };
    const initializer = localInitializer(file.program, local);
    if (initializer !== undefined) {
      return resolveRelation(graph, file, initializer, aliases, lookup, depth + 1);
    }
    const binding = graph.resolveBinding(file.path, local);
    if (binding === null) {
      // Framework/package sources are often absent from the file map (the browser IDE's VFS
      // carries project files only): an imported binding we cannot inspect is opaque, so the
      // runtime guard stays the authority instead of a false "unresolved" error (D-157).
      if (file.module.imports.some((entry) => entry.local === local)) return OPAQUE;
      // A project file map may still omit a framework source: fall back to the SQL name.
      return lookup.names.has(local) ? { kind: "resolved", name: local } : UNRESOLVED;
    }
    const direct = lookup.byBinding.get(binding.file + "#" + binding.name);
    if (direct !== undefined) return { kind: "resolved", name: direct };
    return binding.file.startsWith("node_modules/") ? OPAQUE : UNRESOLVED;
  }
  if (expression.type === "MemberExpression") {
    const property = memberName(expression);
    const object = unwrapExpression(expression.object);
    if (property === undefined || object?.type !== "Identifier") return UNRESOLVED;
    const namespace = identifierName(object);
    if (namespace === undefined) return UNRESOLVED;
    const imported = file.module.imports.find((entry) => entry.local === namespace);
    if (imported === undefined || imported.kind !== "namespace") return UNRESOLVED;
    const target = graph.resolve(file.path, imported.specifier);
    if (target === null) return OPAQUE;
    const name = lookup.byBinding.get(target + "#" + property);
    return name === undefined ? UNRESOLVED : { kind: "resolved", name };
  }
  if (expression.type === "CallExpression") {
    // alias(todos, "t") and similar wrappers: the relation is the first argument that resolves.
    for (const argument of callArguments(expression)) {
      const resolution = resolveRelation(graph, file, argument, aliases, lookup, depth + 1);
      if (resolution.kind !== "unresolved") return resolution;
    }
    return UNRESOLVED;
  }
  return UNRESOLVED;
}

/** The db client an expression denotes directly (a local binding or `ctx.db`), if any. */
export function clientOf(
  node: unknown,
  env: ClientEnv,
  contextName: string | null,
): DbClient | null {
  const expression = unwrapExpression(node);
  if (expression === undefined) return null;
  if (expression.type === "Identifier") {
    const local = identifierName(expression);
    return local === undefined ? null : (env.get(local) ?? null);
  }
  if (expression.type === "MemberExpression" && memberName(expression) === "db") {
    const object = unwrapExpression(expression.object);
    if (object?.type === "Identifier" && identifierName(object) === contextName)
      return ROUTE_CLIENT;
  }
  return null;
}

/** The client at the root of a fluent chain (`db.select()`, `db.query.todos`). */
export function chainClient(
  node: unknown,
  env: ClientEnv,
  contextName: string | null,
): DbClient | null {
  const expression = unwrapExpression(node);
  if (expression === undefined) return null;
  const direct = clientOf(expression, env, contextName);
  if (direct !== null) return direct;
  if (expression.type === "CallExpression") return chainClient(expression.callee, env, contextName);
  if (expression.type === "MemberExpression")
    return chainClient(expression.object, env, contextName);
  return null;
}

/** True when a callee argument carries a db client anywhere (opaque callee detection). */
export function carriesClient(node: AstNode, env: ClientEnv, contextName: string | null): boolean {
  let found = false;
  walk(node, (candidate) => {
    if (!found && clientOf(candidate, env, contextName) !== null) found = true;
  });
  return found;
}

export interface LocalFunction {
  /** Stable identity for the call stack (cycle guard). */
  readonly key: string;
  readonly file: ProjectFile;
  readonly node: AstNode;
}

const FUNCTION_TYPES = new Set([
  "FunctionExpression",
  "FunctionDeclaration",
  "ArrowFunctionExpression",
]);

function functionNode(node: AstNode | undefined): AstNode | undefined {
  const candidate = unwrapExpression(node);
  return candidate !== undefined && FUNCTION_TYPES.has(candidate.type) ? candidate : undefined;
}

/** A project-local function (never a package one: package calls stay opaque, D-157). */
export function resolveLocalFunction(
  graph: ModuleGraph,
  file: ProjectFile,
  callee: unknown,
): LocalFunction | null {
  const expression = unwrapExpression(callee);
  if (expression?.type !== "Identifier") return null;
  const name = identifierName(expression);
  if (name === undefined) return null;
  const declared =
    functionNode(localInitializer(file.program, name)) ??
    functionNode(findDeclaration(file.program, name));
  if (declared !== undefined) return { key: file.path + "#" + name, file, node: declared };
  const binding = graph.resolveBinding(file.path, name);
  if (binding === null || binding.file.startsWith("node_modules/")) return null;
  const target = graph.file(binding.file);
  if (target === undefined) return null;
  const found =
    functionNode(localInitializer(target.program, binding.name)) ??
    functionNode(findDeclaration(target.program, binding.name));
  if (found === undefined) return null;
  return { key: target.path + "#" + binding.name, file: target, node: found };
}
