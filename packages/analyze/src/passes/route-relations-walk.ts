/**
 * The route-relations walker (D-157): starts at the route handler, tracks db clients and
 * relation bindings through local declarations, records `from/join/insert/update/delete`,
 * `db.query.<relation>` and `db.execute`, and hands the interprocedural cases to
 * route-relations-follow.ts. Everything outside the static subset is explicit (opaque or
 * unresolved), never guessed.
 */

import {
  asNode,
  callArguments,
  identifierName,
  memberName,
  nodeArray,
  objectEntries,
  propertyName,
  propertyValue,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { RouteRelationsFact } from "../types-relations.ts";
import type { ElevationKind, SourceRef } from "../types.ts";
import { followFunction, handleElevation } from "./route-relations-follow.ts";
import {
  createUsage,
  freezeUsage,
  addUnresolved,
  addUse,
  markOpaque,
  type MutableUsage,
  type RelationScope,
} from "./route-relations-usage.ts";
import {
  carriesClient,
  chainClient,
  clientOf,
  resolveLocalFunction,
  ROUTE_CLIENT,
  type DbClient,
  type RelationIndex,
} from "./route-relation-resolve.ts";

const MAX_DEPTH = 6;
const RELATION_METHODS = new Set(["from", "innerJoin", "leftJoin", "rightJoin", "fullJoin"]);
const WRITE_METHODS = new Set(["insert", "update", "delete"]);
const SKIPPED_KEYS = new Set(["type", "start", "end", "range"]);

function elevationKind(name: string | undefined): ElevationKind | null {
  return name === "sudo" || name === "system" ? name : null;
}

function refOf(scope: RelationScope, node: AstNode): SourceRef {
  return sourceRef(
    scope.file.path,
    scope.file.source,
    typeof node.start === "number" ? node.start : 0,
  );
}

/** A callee that is `ctx.sudo`/`ctx.system` or a destructured/forwarded elevation handler. */
function calleeElevationKind(
  callee: AstNode | undefined,
  scope: RelationScope,
): ElevationKind | null {
  const expression = unwrapExpression(callee);
  if (expression === undefined) return null;
  if (expression.type === "Identifier") {
    return scope.elevationFns.get(identifierName(expression) ?? "") ?? null;
  }
  if (expression.type !== "MemberExpression") return null;
  const kind = elevationKind(memberName(expression));
  if (kind === null) return null;
  const object = unwrapExpression(expression.object);
  return object?.type === "Identifier" && identifierName(object) === scope.contextName
    ? kind
    : null;
}

/** `db.query.<relation>`: a static property name the runtime guard resolves to a relation. */
function trackQueryMember(node: AstNode, scope: RelationScope): void {
  const property = memberName(node);
  const object = unwrapExpression(node.object);
  if (property === undefined || object?.type !== "MemberExpression") return;
  if (memberName(object) !== "query") return;
  if (clientOf(object.object, scope.env, scope.contextName) === null) return;
  if (scope.index.names.has(property)) addUse(scope, property, refOf(scope, node));
  else addUnresolved(scope, refOf(scope, node));
}

/** `const scoped = ctx.db` / `const rows = todos`: aliases the walk keeps resolving. */
function trackDeclaration(node: AstNode, scope: RelationScope): void {
  if (node.type !== "VariableDeclarator") return;
  const name = identifierName(node.id);
  if (name === undefined) return;
  const client = clientOf(node.init, scope.env, scope.contextName);
  if (client !== null) {
    scope.env.set(name, client);
    return;
  }
  const resolution = scope.index.resolve(scope.graph, scope.file, asNode(node.init), scope.aliases);
  if (resolution.kind === "resolved") scope.aliases.set(name, resolution.name);
}

function recordRelation(scope: RelationScope, node: AstNode | undefined): void {
  if (node === undefined) return;
  const resolution = scope.index.resolve(scope.graph, scope.file, node, scope.aliases);
  if (resolution.kind === "resolved") addUse(scope, resolution.name, refOf(scope, node));
  else if (resolution.kind === "unresolved") addUnresolved(scope, refOf(scope, node));
  else markOpaque(scope);
}

function handleCall(node: AstNode, scope: RelationScope): boolean {
  const callee = unwrapExpression(node.callee);
  const kind = calleeElevationKind(callee, scope);
  if (kind !== null) return handleElevation(visit, node, scope, kind);
  if (callee?.type === "MemberExpression") {
    const name = memberName(callee);
    const object = unwrapExpression(callee.object);
    if (name === "execute" && chainClient(object, scope.env, scope.contextName) !== null) {
      scope.usage.rawSql.push(refOf(scope, node));
      return false;
    }
    if (
      name !== undefined &&
      RELATION_METHODS.has(name) &&
      chainClient(object, scope.env, scope.contextName) !== null
    ) {
      recordRelation(scope, callArguments(node)[0]);
      return false;
    }
    if (
      name !== undefined &&
      WRITE_METHODS.has(name) &&
      clientOf(object, scope.env, scope.contextName) !== null
    ) {
      recordRelation(scope, callArguments(node)[0]);
      return false;
    }
  }
  const local = resolveLocalFunction(scope.graph, scope.file, callee);
  if (local !== null) {
    followFunction(visit, node, scope, local);
    return true;
  }
  // A project-external callee that receives the client makes the usage opaque: the runtime
  // guard is the authority, so the pass must not raise a false undeclared/unused error.
  if (
    callArguments(node).some((argument) => carriesClient(argument, scope.env, scope.contextName))
  ) {
    markOpaque(scope);
  }
  return false;
}

function visit(node: AstNode, scope: RelationScope): void {
  if (scope.depth > MAX_DEPTH) return;
  trackDeclaration(node, scope);
  if (node.type === "MemberExpression") trackQueryMember(node, scope);
  if (node.type === "CallExpression" && handleCall(node, scope)) return;
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value)
        if (asNode(child) !== undefined) visit(asNode(child) as AstNode, scope);
      continue;
    }
    const child = asNode(value);
    if (child !== undefined) visit(child, scope);
  }
}

function handlerScope(
  graph: ModuleGraph,
  file: ProjectFile,
  handler: AstNode,
  index: RelationIndex,
  usage: MutableUsage,
): RelationScope {
  const env = new Map<string, DbClient>();
  const elevationFns = new Map<string, ElevationKind>();
  let contextName: string | null = null;
  const context = unwrapExpression(nodeArray(handler, "params")[1]);
  if (context?.type === "Identifier") contextName = identifierName(context) ?? null;
  else if (context?.type === "ObjectPattern") {
    for (const entry of objectEntries(context)) {
      if (entry.type !== "Property") continue;
      const name = propertyName(entry);
      let value = propertyValue(entry);
      if (value?.type === "AssignmentPattern") value = unwrapExpression(value.left);
      const local = identifierName(unwrapExpression(value));
      const kind = elevationKind(name);
      if (local === undefined) continue;
      if (name === "db") env.set(local, ROUTE_CLIENT);
      else if (kind !== null) elevationFns.set(local, kind);
    }
  }
  return {
    graph,
    index,
    file,
    env,
    aliases: new Map(),
    elevationFns,
    contextName,
    elevation: null,
    depth: 0,
    stack: new Set(),
    usage,
  };
}

/** Scan one valid route handler into its relation-usage fact. */
export function scanHandlerUsage(
  graph: ModuleGraph,
  file: ProjectFile,
  handler: AstNode,
  index: RelationIndex,
): RouteRelationsFact {
  const body = asNode(handler.body);
  const usage = createUsage();
  if (body !== undefined) visit(body, handlerScope(graph, file, handler, index, usage));
  return freezeUsage(usage);
}
