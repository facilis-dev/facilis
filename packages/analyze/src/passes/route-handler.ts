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

/** Every `ctx.rawDb({ reason })` call in the handler, with the reason it declares (D-226). */
export function handlerRawDbCalls(
  call: AstNode,
  file: ProjectFile,
  fallback: SourceRef,
): RawDbCallFact[] {
  const handler = callArguments(call)[1];
  if (handler === undefined) return [];
  const calls: RawDbCallFact[] = [];
  walk(handler, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = asNode(unwrapExpression(node.callee));
    // A raw route destructures the context (`{ rawDb }`), an authorized handler uses
    // `ctx.rawDb`; both are the same declared accessor (D-226).
    const isRawDb =
      (callee?.type === "MemberExpression" && memberName(callee) === "rawDb") ||
      (callee?.type === "Identifier" && identifierName(callee) === "rawDb");
    if (!isRawDb) return;
    const argument = asNode(unwrapExpression(callArguments(node)[0]));
    let reason: string | null = null;
    if (argument?.type === "ObjectExpression") {
      const entry = objectEntries(argument).find(
        (item) => item.type === "Property" && propertyName(item) === "reason",
      );
      const value = literalString(entry?.value);
      if (value !== undefined && value.trim().length > 0) reason = value.trim();
    }
    calls.push({ reason, source: nodeRef(file, node, fallback) });
  });
  return calls;
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
