/**
 * Client path expressions -> static prefixes and route matches (§3.4 of the AST DSL
 * contract).
 *
 * A path is read as a static prefix plus a dynamic tail: literal strings and const strings
 * are exact, while concatenations and templates keep the leading static segments. One hop of
 * a path-builder function is inlined (the builder's return expression); anything deeper is
 * dynamic, not guessed.
 */

import {
  asNode,
  identifierName,
  isAstNode,
  nodeArray,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { defaultExportDeclaration, localInitializer } from "../module-info.ts";
import { evaluateStatic, type StaticContext } from "../static-eval.ts";
import type { HttpMethod, PathKind, RouteFact, UnknownFact } from "../types.ts";
import { routeFactId } from "./route-location.ts";
import { findDeclaration, refOf } from "./static-read.ts";

const MAX_RESOLVE_DEPTH = 8;
export interface ExtractedPath {
  readonly kind: PathKind;
  /** Source text of the argument, for the inspector. */
  readonly expression: string;
  /** Leading static text; null when the path has no readable static part. */
  readonly staticPrefix: string | null;
  /** Fully static path, when the whole expression is known. */
  readonly path: string | null;
  readonly unknown: readonly UnknownFact[];
}
interface PartialPrefix {
  readonly prefix: string;
  readonly complete: boolean;
}

function sourceText(source: string, node: AstNode | undefined): string {
  if (node === undefined || typeof node.start !== "number" || typeof node.end !== "number") {
    return "";
  }
  return source.slice(node.start, node.end).trim();
}

function cookedString(quasi: AstNode | undefined): string {
  // TemplateElement.value is a plain { raw, cooked } record, not an AST node (asNode rejects it).
  const value = quasi?.value;
  if (typeof value !== "object" || value === null) return "";
  const cooked = (value as Record<string, unknown>).cooked;
  return typeof cooked === "string" ? cooked : "";
}

function evaluatePrimitive(node: AstNode, context: StaticContext): string | null {
  const evaluated = evaluateStatic(node, context);
  const value = evaluated.ok ? evaluated.value : undefined;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : null;
}

/** Leading static text of a literal, template or `+` chain, plus whether it is whole. */
function partialStaticPrefix(
  node: AstNode | undefined,
  context: StaticContext,
  depth = 0,
): PartialPrefix | null {
  if (node === undefined || depth > MAX_RESOLVE_DEPTH) return null;
  const unwrapped = unwrapExpression(node);
  if (unwrapped === undefined) return null;
  if (unwrapped.type === "Literal") {
    return typeof unwrapped.value === "string" ? { prefix: unwrapped.value, complete: true } : null;
  }
  if (unwrapped.type === "TemplateLiteral") {
    const quasis = nodeArray(unwrapped, "quasis");
    const expressions = nodeArray(unwrapped, "expressions");
    let prefix = "";
    for (const [index, quasi] of quasis.entries()) {
      prefix += cookedString(quasi);
      const expression = expressions[index];
      if (expression === undefined) continue;
      const value = evaluatePrimitive(expression, context);
      if (value === null) return { prefix, complete: false };
      prefix += value;
    }
    return { prefix, complete: true };
  }
  if (unwrapped.type === "BinaryExpression" && unwrapped.operator === "+") {
    const left = partialStaticPrefix(asNode(unwrapped.left), context, depth + 1);
    if (left === null) return null;
    if (!left.complete) return left;
    const right = partialStaticPrefix(asNode(unwrapped.right), context, depth + 1);
    return right === null
      ? { prefix: left.prefix, complete: false }
      : { prefix: left.prefix + right.prefix, complete: right.complete };
  }
  const value = evaluatePrimitive(unwrapped, context);
  return value === null ? null : { prefix: value, complete: true };
}

function firstReturn(node: AstNode): AstNode | undefined {
  if (node.type === "ReturnStatement") return asNode(node.argument);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    const children = (Array.isArray(value) ? value : [value]).filter(isAstNode);
    for (const child of children) {
      // A nested function owns its return statements; only this function's count.
      if (child.type.endsWith("FunctionExpression") || child.type === "FunctionDeclaration") {
        continue;
      }
      const found = firstReturn(child);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function functionReturnExpression(fn: AstNode): AstNode | undefined {
  const body = asNode(fn.body);
  if (body === undefined) return undefined;
  return body.type === "BlockStatement" ? firstReturn(body) : body;
}

/** Inline one hop of an imported path-builder function (its return expression). */
function resolvePathBuilder(call: AstNode, context: StaticContext): PartialPrefix | null {
  const callee = unwrapExpression(call.callee);
  const name = identifierName(callee);
  const file = context.graph.file(context.file);
  if (name === undefined || file === undefined) return null;
  const imported = file.module.imports.find((entry) => entry.local === name);
  if (imported === undefined) return null;
  const target = context.graph.resolve(context.file, imported.specifier);
  if (target === null || target.startsWith("node_modules/")) return null;
  const binding = context.graph.resolveExport(target, imported.imported ?? "default");
  if (binding === null) return null;
  const module = context.graph.file(binding.file);
  if (module === undefined) return null;
  const initializer =
    binding.name === "default"
      ? defaultExportDeclaration(module.program)
      : (localInitializer(module.program, binding.name) ??
        findDeclaration(module.program, binding.name));
  const fn = unwrapExpression(initializer);
  if (fn === undefined || !/Function/.test(fn.type)) return null;
  const returned = functionReturnExpression(fn);
  if (returned === undefined) return null;
  return partialStaticPrefix(returned, { graph: context.graph, file: module.path });
}

/** Extract the path of one client call; failures stay in the unknown channel. */
export function extractPathExpression(
  argument: AstNode | undefined,
  context: StaticContext,
  call: AstNode,
  code: string,
): ExtractedPath {
  const file = context.graph.file(context.file);
  const source = file?.source ?? "";
  const callRef = refOf(context, call);
  const argumentNode = unwrapExpression(argument);
  const expression = sourceText(source, argumentNode) || sourceText(source, call);
  if (argumentNode === undefined) {
    return {
      kind: "dynamic",
      expression,
      staticPrefix: null,
      path: null,
      unknown: [{ code, reason: "the call has no path argument", source: callRef }],
    };
  }

  const unknown: UnknownFact[] = [];
  if (argumentNode.type === "CallExpression") {
    const builder = resolvePathBuilder(argumentNode, context);
    if (builder !== null) {
      return {
        kind: "builder",
        expression,
        staticPrefix: builder.prefix.length === 0 ? null : builder.prefix,
        path: builder.complete ? builder.prefix : null,
        unknown,
      };
    }
    unknown.push({
      code,
      reason: "the path builder could not be resolved statically",
      source: callRef,
    });
    return { kind: "unknown", expression, staticPrefix: null, path: null, unknown };
  }

  if (argumentNode.type === "TemplateLiteral" || argumentNode.type === "BinaryExpression") {
    const partial = partialStaticPrefix(argumentNode, context);
    if (partial !== null) {
      return {
        kind: argumentNode.type === "TemplateLiteral" ? "template" : "concat",
        expression,
        staticPrefix: partial.prefix.length === 0 ? null : partial.prefix,
        path: partial.complete ? partial.prefix : null,
        unknown,
      };
    }
  }

  const evaluated = evaluateStatic(argumentNode, context);
  if (evaluated.ok && typeof evaluated.value === "string") {
    return {
      kind: "literal",
      expression,
      staticPrefix: evaluated.value.length === 0 ? null : evaluated.value,
      path: evaluated.value,
      unknown,
    };
  }
  unknown.push({
    code,
    reason: evaluated.ok ? "the path is not a string" : evaluated.reason,
    source: callRef,
  });
  return { kind: "dynamic", expression, staticPrefix: null, path: null, unknown };
}

function pathSegments(path: string): string[] {
  const base = path.split("?")[0] ?? "";
  return (base.split("#")[0] ?? "").split("/").filter(Boolean);
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("{") && segment.endsWith("}");
}

function templateMatches(template: readonly string[], segments: readonly string[]): boolean {
  let index = 0;
  for (; index < template.length; index += 1) {
    const templateSegment = template[index] ?? "";
    if (templateSegment.startsWith("{*")) return segments.length > index;
    if (isDynamicSegment(templateSegment)) {
      if (index >= segments.length) return false;
      continue;
    }
    if (segments[index] !== templateSegment) return false;
  }
  return segments.length === index;
}

function prefixMatches(
  template: readonly string[],
  prefixSegments: readonly string[],
  trailingSlash: boolean,
): boolean {
  for (const [index, prefixSegment] of prefixSegments.entries()) {
    const templateSegment = template[index];
    if (templateSegment === undefined) return false;
    if (templateSegment.startsWith("{*")) return false;
    if (isDynamicSegment(templateSegment)) continue;
    if (templateSegment !== prefixSegment) return false;
  }
  const rest = template.slice(prefixSegments.length);
  // A trailing slash means at least one more (dynamic) segment at the call site.
  if (trailingSlash && rest.length === 0) return false;
  return rest.every((segment) => isDynamicSegment(segment));
}

function routeMatches(
  routePath: string,
  path: string | null,
  staticPrefix: string | null,
): boolean {
  const template = pathSegments(routePath);
  if (path !== null) return templateMatches(template, pathSegments(path));
  if (staticPrefix === null) return false;
  return prefixMatches(template, pathSegments(staticPrefix), staticPrefix.endsWith("/"));
}

/** Route ids whose template can produce the call path for the given method. */
export function matchRouteIds(
  routes: readonly RouteFact[],
  path: string | null,
  staticPrefix: string | null,
  method: HttpMethod,
): string[] {
  if (path === null && staticPrefix === null) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    if (route.method !== "ALL" && route.method !== method) continue;
    if (!routeMatches(route.path, path, staticPrefix)) continue;
    const id = routeFactId(route);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
