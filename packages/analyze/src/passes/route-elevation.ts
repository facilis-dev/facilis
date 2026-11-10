/**
 * Audited elevation facts from a route handler (D-099): `ctx.sudo` and `ctx.system`.
 *
 * Only the handler's own context can elevate: a destructured `{ sudo }`/`{ system }` binding
 * or a member call on the context parameter. Any other identifier named `sudo` is ignored, so
 * the graph cannot be colored by a local helper with the same name. The tables and operation
 * are read through the bounded static subset; when that fails the fact is explicit (unknown
 * plus an empty table list), never guessed.
 */

import {
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
import { walk } from "../ast/walk.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { ElevationFact, ElevationKind, SourceRef, UnknownFact } from "../types.ts";
import { readStaticObject } from "./static-read.ts";

export interface ElevationScan {
  readonly facts: readonly ElevationFact[];
  readonly unknown: readonly UnknownFact[];
}

function refOf(file: ProjectFile, node: AstNode): SourceRef {
  const offset = typeof node.start === "number" ? node.start : 0;
  let line = 1;
  for (let index = 0; index < offset && index < file.source.length; index += 1) {
    if (file.source.charCodeAt(index) === 10) line += 1;
  }
  return { file: file.path, line };
}

function elevationKind(name: string | undefined): ElevationKind | null {
  if (name === "sudo" || name === "system") return name;
  return null;
}

interface HandlerBindings {
  readonly locals: ReadonlyMap<string, ElevationKind>;
  readonly contextName: string | null;
}

/** Local identifier -> elevation kind for `{ sudo }` / `{ sudo: elevate }`. */
function handlerBindings(handler: AstNode): HandlerBindings {
  const locals = new Map<string, ElevationKind>();
  const context = nodeArray(handler, "params")[1];
  if (context === undefined) return { locals, contextName: null };
  if (context.type === "Identifier") {
    return { locals, contextName: identifierName(context) ?? null };
  }
  if (context.type !== "ObjectPattern") return { locals, contextName: null };
  for (const entry of objectEntries(context)) {
    if (entry.type !== "Property") continue;
    const kind = elevationKind(propertyName(entry));
    if (kind === null) continue;
    let value = propertyValue(entry);
    if (value !== undefined && value.type === "AssignmentPattern") {
      value = unwrapExpression(value.left);
    }
    const local = identifierName(unwrapExpression(value));
    if (local !== undefined) locals.set(local, kind);
  }
  return { locals, contextName: null };
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry): entry is string => typeof entry === "string") ? [...value] : null;
}

/** Scan one `defineAuthorizedHandler` call's handler for audited elevations. */
export function scanElevations(
  graph: ModuleGraph,
  file: ProjectFile,
  wrapperCall: AstNode,
): ElevationScan {
  const handler = callArguments(wrapperCall)[1];
  if (handler === undefined) return { facts: [], unknown: [] };
  const handlerNode = unwrapExpression(handler);
  if (
    handlerNode === undefined ||
    (handlerNode.type !== "ArrowFunctionExpression" && handlerNode.type !== "FunctionExpression")
  ) {
    return { facts: [], unknown: [] };
  }
  const bindings = handlerBindings(handlerNode);
  const facts: ElevationFact[] = [];
  const unknown: UnknownFact[] = [];
  walk(handlerNode, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = unwrapExpression(node.callee);
    if (callee === undefined) return;
    let kind: ElevationKind | null = null;
    if (callee.type === "Identifier") {
      kind = bindings.locals.get(identifierName(callee) ?? "") ?? null;
    } else if (callee.type === "MemberExpression") {
      const name = memberName(callee);
      const object = unwrapExpression(callee.object);
      if (
        name !== undefined &&
        object?.type === "Identifier" &&
        identifierName(object) === bindings.contextName
      ) {
        kind = elevationKind(name);
      }
    }
    if (kind === null) return;
    const source = refOf(file, node);
    const options = readStaticObject(
      callArguments(node)[0],
      { graph, file: file.path },
      {
        code: "route-elevation-static",
        report: true,
      },
    );
    const factUnknown: UnknownFact[] = [...options.unknown];
    const tablesField = options.fields.get("tables");
    let tables: string[] = [];
    if (tablesField === undefined) {
      factUnknown.push({
        code: "route-elevation-static",
        reason: "elevation tables are missing",
        source,
      });
    } else if (!tablesField.ok) {
      factUnknown.push({
        code: "route-elevation-static",
        reason: "elevation tables cannot be read statically",
        source,
      });
    } else {
      const read = stringArray(tablesField.value);
      if (read === null) {
        factUnknown.push({
          code: "route-elevation-static",
          reason: "elevation tables must be a string[]",
          source,
        });
      } else {
        tables = read;
      }
    }
    const operationField = options.fields.get("operation");
    const operation =
      operationField !== undefined && operationField.ok && typeof operationField.value === "string"
        ? operationField.value
        : null;
    unknown.push(...factUnknown);
    facts.push({ kind, tables, operation, source, unknown: factUnknown });
  });
  return { facts, unknown };
}
