/**
 * Interprocedural part of the route-relations pass (D-157): follow a project-local function
 * with argument mapping, and enter an audited elevation callback with its elevated client.
 *
 * Package calls stay opaque: the runtime guard is the authority there. Following is bounded
 * by MAX_DEPTH (walk) and guarded by `scope.stack`, so recursion with a db client terminates.
 */

import {
  asNode,
  callArguments,
  identifierName,
  memberName,
  nodeArray,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { sourceRef } from "../source.ts";
import type { ElevationKind, SourceRef } from "../types.ts";
import type { DbClient, LocalFunction } from "./route-relation-resolve.ts";
import { clientOf } from "./route-relation-resolve.ts";
import type { MutableElevation, RelationScope } from "./route-relations-usage.ts";
import { readStaticObject } from "./static-read.ts";

export type Visit = (node: AstNode, scope: RelationScope) => void;

function refOf(scope: RelationScope, node: AstNode): SourceRef {
  return sourceRef(
    scope.file.path,
    scope.file.source,
    typeof node.start === "number" ? node.start : 0,
  );
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry): entry is string => typeof entry === "string") ? [...value] : null;
}

/** Follow a project-local call, mapping db clients, elevation handlers and relation bindings. */
export function followFunction(
  visit: Visit,
  node: AstNode,
  scope: RelationScope,
  local: LocalFunction,
): void {
  if (scope.stack.has(local.key)) return;
  const args = callArguments(node);
  // Usage inside the arguments belongs to the caller (e.g. a query handed to a helper).
  for (const argument of args) visit(argument, scope);
  const env = new Map(scope.env);
  const aliases = new Map(scope.aliases);
  const elevationFns = new Map(scope.elevationFns);
  for (const [position, param] of nodeArray(local.node, "params").entries()) {
    const name = identifierName(param);
    const argument = args[position];
    if (name === undefined || argument === undefined) continue;
    const client = clientOf(argument, scope.env, scope.contextName);
    if (client !== null) {
      env.set(name, client);
      continue;
    }
    const kind = elevationKindOf(argument, scope);
    if (kind !== null) {
      elevationFns.set(name, kind);
      continue;
    }
    const resolution = scope.index.resolve(scope.graph, scope.file, argument, scope.aliases);
    if (resolution.kind === "resolved") aliases.set(name, resolution.name);
  }
  const body = asNode(local.node.body);
  if (body === undefined) return;
  visit(body, {
    ...scope,
    file: local.file,
    env,
    aliases,
    elevationFns,
    contextName: null,
    depth: scope.depth + 1,
    stack: new Set([...scope.stack, local.key]),
  });
}

/** An argument that denotes `ctx.sudo`/`ctx.system` (destructured or forwarded). */
function elevationKindOf(argument: AstNode, scope: RelationScope): ElevationKind | null {
  const expression = unwrapExpression(argument);
  if (expression?.type === "Identifier") {
    return scope.elevationFns.get(identifierName(expression) ?? "") ?? null;
  }
  if (expression?.type !== "MemberExpression") return null;
  const name = memberName(expression);
  const kind = name === "sudo" || name === "system" ? name : null;
  if (kind === null) return null;
  const object = unwrapExpression(expression.object);
  return object?.type === "Identifier" && identifierName(object) === scope.contextName
    ? kind
    : null;
}

/** Enter an elevation callback with its elevated client bound to the first parameter. */
export function handleElevation(
  visit: Visit,
  node: AstNode,
  scope: RelationScope,
  kind: ElevationKind,
): boolean {
  const options = readStaticObject(
    callArguments(node)[0],
    { graph: scope.graph, file: scope.file.path },
    { code: "route-relations-static", report: false },
  );
  const field = options.fields.get("tables");
  const read = field !== undefined && field.ok ? stringArray(field.value) : null;
  const tables: string[] = read ?? [];
  const tablesUnknown = read === null;
  const elevation: MutableElevation = {
    kind,
    source: refOf(scope, node),
    tables,
    tablesUnknown,
    used: new Map(),
    unresolved: [],
    opaque: false,
  };
  const index = scope.usage.elevations.push(elevation) - 1;
  const callback = unwrapExpression(callArguments(node)[1]);
  if (
    callback === undefined ||
    (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression")
  ) {
    // A callback we cannot inspect leaves the elevated usage unknown, never guessed.
    elevation.opaque = true;
    return false;
  }
  const body = asNode(callback.body);
  if (body === undefined) {
    elevation.opaque = true;
    return false;
  }
  const env = new Map<string, DbClient>(scope.env);
  const param = identifierName(nodeArray(callback, "params")[0]);
  if (param !== undefined) env.set(param, { elevation: index });
  visit(body, { ...scope, env, elevation: index, depth: scope.depth + 1 });
  return true;
}
