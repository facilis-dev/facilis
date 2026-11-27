/**
 * Facts read from a route handler expression (docs/findings/ast-dsl-contract.md §3.1).
 *
 * The security rules need to know whether a handler reads the request input — the JSON body
 * or the multipart form: the fact must come from the AST, not from a comment or a string, so
 * a route cannot look validated by mentioning `body`/`form` in prose.
 *
 * The same reasoning drives the direct-DB warning: a handler that reaches the raw client
 * through `event.context.facilis.db` or imports the `createDb` factory bypasses the
 * policy-scoped client, and only the AST can tell a real access from a string mention.
 */

import {
  asNode,
  callArguments,
  identifierName,
  literalString,
  memberName,
  nodeArray,
  objectEntries,
  propertyName,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import { warning } from "../diagnostics.ts";
import type { ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { Diagnostic, SourceRef } from "../types.ts";
import type { RawDbCallFact } from "../types-surface.ts";

const RAW_DB_SPECIFIER = "@facilis.dev/db";
const RAW_DB_FACTORY = "createDb";

/** Warning text for raw/direct DB access in a route file. */
export const ROUTE_DIRECT_DB_MESSAGE =
  "Direct DB access bypasses the policy-scoped client; use ctx.db for user-scoped work and ctx.system/ctx.sudo for audited system operations (not recommended).";

function nodeRef(file: ProjectFile, node: AstNode, fallback: SourceRef): SourceRef {
  return typeof node.start === "number" ? sourceRef(file.path, file.lines, node.start) : fallback;
}

/** True when the object chain of `node` contains a `.facilis` property. */
function touchesFacilisContext(node: AstNode): boolean {
  let current: AstNode | undefined = node;
  while (current !== undefined && current.type === "MemberExpression") {
    if (memberName(current) === "facilis") return true;
    current = asNode(unwrapExpression(current.object));
  }
  return false;
}

/** `event.context.facilis.db` (or any `*.facilis.db` access): the raw policy-free client. */
function isDirectDbMember(node: AstNode): boolean {
  if (node.type !== "MemberExpression" || memberName(node) !== "db") return false;
  const object = asNode(unwrapExpression(node.object));
  return object !== undefined && touchesFacilisContext(object);
}

/** True when the handler reads `name` off the request: member access or destructuring. */
function handlerReads(call: AstNode, name: string): boolean {
  const handler = callArguments(call)[1];
  if (handler === undefined) return false;
  let found = false;
  walk(handler, (node) => {
    if (found) return;
    if (node.type === "MemberExpression" && memberName(node) === name) {
      found = true;
      return;
    }
    if (
      node.type === "ObjectPattern" &&
      objectEntries(node).some((entry) => entry.type === "Property" && propertyName(entry) === name)
    ) {
      found = true;
    }
  });
  return found;
}

/** True when the handler reads `.body` or destructures a `{ body }` pattern. */
export function handlerReadsBody(call: AstNode): boolean {
  return handlerReads(call, "body");
}

/** True when the handler reads `.form` or destructures a `{ form }` pattern (D-053). */
export function handlerReadsForm(call: AstNode): boolean {
  return handlerReads(call, "form");
}

export interface RawDbScan {
  /** Every rawDb site: a declared call, or a null-reason escape that must fail closed. */
  readonly calls: readonly RawDbCallFact[];
  /** The handler body is not analysable (imported handler, whole ctx passed to a helper). */
  readonly opaque: boolean;
}

function callReason(node: AstNode): string | null {
  const argument = asNode(unwrapExpression(callArguments(node)[0]));
  if (argument?.type !== "ObjectExpression") return null;
  const entry = objectEntries(argument).find(
    (item) => item.type === "Property" && propertyName(item) === "reason",
  );
  const value = literalString(entry?.value);
  return value !== undefined && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Every rawDb site in the handler (D-226). The accessor is an escape from the table guard, so
 * ANY reference counts: an alias (`const dba = ctx.rawDb`), a renamed binding
 * (`{ rawDb: dba }`), a pass-through argument or a helper receiving the whole ctx is a
 * null-reason site, never green. A declared call is only the direct call with a literal
 * non-empty reason. An imported handler body cannot be inspected, so it is opaque (unknown).
 */
export function handlerRawDbCalls(
  call: AstNode,
  file: ProjectFile,
  fallback: SourceRef,
): RawDbScan {
  const handler = asNode(unwrapExpression(callArguments(call)[1]));
  if (handler === undefined) return { calls: [], opaque: true };
  if (handler.type !== "FunctionExpression" && handler.type !== "ArrowFunctionExpression") {
    return { calls: [], opaque: true };
  }

  const params = nodeArray(handler, "params");
  // Both DSLs pass the request event first and the context second.
  const contextParam = params[1] === undefined ? undefined : asNode(unwrapExpression(params[1]));
  let bindingParam: AstNode | undefined;
  let contextName: string | undefined;
  let bindingName: string | undefined;
  if (contextParam?.type === "Identifier") contextName = identifierName(contextParam);
  for (const param of params) {
    const pattern = asNode(unwrapExpression(param));
    if (pattern?.type !== "ObjectPattern") continue;
    for (const entry of objectEntries(pattern)) {
      if (entry.type !== "Property" || propertyName(entry) !== "rawDb") continue;
      bindingName = identifierName(entry.value) ?? "rawDb";
      bindingParam = pattern;
    }
  }
  // `const { rawDb } = ctx` inside the body is the same capability.
  walk(handler, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const id = asNode(node.id);
    if (id?.type !== "ObjectPattern") return;
    for (const entry of objectEntries(id)) {
      if (entry.type !== "Property" || propertyName(entry) !== "rawDb") continue;
      bindingName = identifierName(entry.value) ?? "rawDb";
      bindingParam = id;
    }
  });

  const calls: RawDbCallFact[] = [];
  const sites: RawDbCallFact[] = [];
  const calledMembers = new Set<number>();
  let directCalls = 0;
  walk(handler, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = asNode(unwrapExpression(node.callee));
    const memberCall = callee?.type === "MemberExpression" && memberName(callee) === "rawDb";
    const bindingCall =
      bindingName !== undefined &&
      callee?.type === "Identifier" &&
      identifierName(callee) === bindingName;
    if (!memberCall && !bindingCall) return;
    if (memberCall && typeof callee.start === "number") calledMembers.add(callee.start);
    directCalls += 1;
    calls.push({ reason: callReason(node), source: nodeRef(file, node, fallback) });
  });

  // A member access that is not the callee of a direct call is an alias/pass-through escape.
  walk(handler, (node) => {
    if (node.type !== "MemberExpression" || memberName(node) !== "rawDb") return;
    if (typeof node.start === "number" && calledMembers.has(node.start)) return;
    sites.push({ reason: null, source: nodeRef(file, node, fallback) });
  });

  if (bindingName !== undefined) {
    const skipNode = bindingParam ?? contextParam;
    const skipStart = typeof skipNode?.start === "number" ? skipNode.start : Number.NaN;
    const skipEnd = typeof skipNode?.end === "number" ? skipNode.end : Number.NaN;
    let occurrences = 0;
    walk(handler, (node) => {
      if (node.type !== "Identifier" || identifierName(node) !== bindingName) return;
      const start = typeof node.start === "number" ? node.start : Number.NaN;
      if (!Number.isNaN(skipStart) && !Number.isNaN(skipEnd) && start >= skipStart && start < skipEnd) {
        return;
      }
      occurrences += 1;
    });
    if (occurrences > directCalls) sites.push({ reason: null, source: fallback });
  }

  let opaque = false;
  if (contextName !== undefined) {
    walk(handler, (node) => {
      if (node.type !== "CallExpression") return;
      for (const argument of nodeArray(node, "arguments")) {
        const value = asNode(unwrapExpression(argument));
        if (value?.type === "Identifier" && identifierName(value) === contextName) opaque = true;
      }
    });
  }

  return { calls: [...calls, ...sites], opaque };
}

/**
 * Warnings for raw/direct DB access in a route file: `event.context.facilis.db` bypasses
 * the policy-scoped client, and importing the `createDb` factory is the raw-client path.
 * The source points at the offending node (or the route when a node has no position), so
 * the IDE can jump to it.
 */
export function directDbWarnings(file: ProjectFile, fallback: SourceRef): Diagnostic[] {
  const refs: SourceRef[] = [];
  walk(file.program, (node) => {
    if (isDirectDbMember(node)) refs.push(nodeRef(file, node, fallback));
  });
  for (const imported of file.module.imports) {
    if (imported.specifier === RAW_DB_SPECIFIER && imported.imported === RAW_DB_FACTORY) {
      refs.push(imported.source);
    }
  }
  refs.sort((left, right) => left.line - right.line);
  return refs.map((source) => warning("route-direct-db", ROUTE_DIRECT_DB_MESSAGE, source));
}
