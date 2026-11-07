/**
 * Helpers shared by the analyzer passes: the static object reader (§4 of the AST DSL
 * contract) and deterministic diagnostic ordering.
 *
 * The reader is deliberately partial: every property is evaluated on its own so one computed
 * value cannot hide its siblings. It never executes project code and it never defaults an
 * unreadable value - the caller decides whether the unknown is a security error.
 */

import {
  identifierName,
  objectEntries,
  propertyName,
  propertyValue,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { declarationNames, defaultExportDeclaration, localInitializer } from "../module-info.ts";
import type { ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import { evaluateStatic, type StaticContext } from "../static-eval.ts";
import type { Diagnostic, SourceRef, UnknownFact } from "../types.ts";

export interface StaticField {
  readonly value: unknown;
  readonly ok: boolean;
  readonly node: AstNode | undefined;
  /** Why the value is not static; null when ok. */
  readonly reason: string | null;
}

export interface StaticObject {
  readonly fields: ReadonlyMap<string, StaticField>;
  readonly unknown: readonly UnknownFact[];
}

export interface StaticReadOptions {
  /** Diagnostic/unknown code recorded for constructs outside the static subset. */
  readonly code: string;
  /** Whether a field that fails to evaluate is reported (sections re-read for detail). */
  readonly report: boolean;
}

const MAX_RESOLVE_DEPTH = 8;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function projectPath(root: string, path: string): string {
  return root.length === 0 ? path : root + "/" + path;
}

/** Project-relative path with the graph root stripped (the opposite of projectPath). */
export function relativePath(root: string, path: string): string {
  return root.length === 0 || !path.startsWith(root + "/") ? path : path.slice(root.length + 1);
}

export function refOf(context: StaticContext, node: AstNode | undefined): SourceRef {
  const file = context.graph.file(context.file);
  const offset = node !== undefined && typeof node.start === "number" ? node.start : 0;
  return sourceRef(context.file, file?.source ?? "", offset);
}

function objectLiteral(
  node: AstNode | undefined,
  context: StaticContext,
  depth = 0,
): AstNode | undefined {
  if (node === undefined || depth > MAX_RESOLVE_DEPTH) return undefined;
  const unwrapped = unwrapExpression(node);
  if (unwrapped === undefined) return undefined;
  if (unwrapped.type === "ObjectExpression") return unwrapped;
  const file = context.graph.file(context.file);
  const name = identifierName(unwrapped);
  if (file === undefined || name === undefined) return undefined;
  return objectLiteral(localInitializer(file.program, name), context, depth + 1);
}

/** Partial, non-executing reader for object literals in the static subset. */
export function readStaticObject(
  node: AstNode | undefined,
  context: StaticContext,
  options: StaticReadOptions,
): StaticObject {
  const fields = new Map<string, StaticField>();
  const unknown: UnknownFact[] = [];
  if (node === undefined) return { fields, unknown };
  const record = (reason: string, at: AstNode | undefined, structural: boolean): void => {
    if (structural || options.report) {
      unknown.push({ code: options.code, reason, source: refOf(context, at) });
    }
  };

  const literal = objectLiteral(node, context);
  if (literal !== undefined) {
    for (const entry of objectEntries(literal)) {
      if (entry.type === "SpreadElement") {
        record("spread in an object literal cannot be read statically", entry, true);
        continue;
      }
      const key = propertyName(entry);
      if (key === undefined) {
        record("computed object key cannot be read statically", entry, true);
        continue;
      }
      const valueNode = propertyValue(entry);
      const evaluated = evaluateStatic(valueNode, context);
      if (evaluated.ok) {
        fields.set(key, { value: evaluated.value, ok: true, node: valueNode, reason: null });
      } else {
        fields.set(key, { value: undefined, ok: false, node: valueNode, reason: evaluated.reason });
        record(evaluated.reason, valueNode ?? entry, false);
      }
    }
    return { fields, unknown };
  }

  const evaluated = evaluateStatic(node, context);
  if (evaluated.ok && isRecord(evaluated.value)) {
    for (const [key, value] of Object.entries(evaluated.value)) {
      fields.set(key, { value, ok: true, node: undefined, reason: null });
    }
    return { fields, unknown };
  }
  record(evaluated.ok ? "value is not an object" : evaluated.reason, node, true);
  return { fields, unknown };
}

/**
 * The default export, unwrapped and resolved through a same-file const or a
 * `export { handler as default }` statement.
 */
export function defaultExportExpression(file: ProjectFile): AstNode | undefined {
  const declaration = defaultExportDeclaration(file.program);
  if (declaration !== undefined) {
    const unwrapped = unwrapExpression(declaration);
    const name = unwrapped?.type === "Identifier" ? identifierName(unwrapped) : undefined;
    return name === undefined ? unwrapped : unwrapExpression(localInitializer(file.program, name));
  }
  const entry = file.module.exports.find(
    (item) => item.exported === "default" && item.local !== null,
  );
  if (entry === undefined || entry.local === null) return undefined;
  return unwrapExpression(localInitializer(file.program, entry.local));
}

/** A top-level function/class declaration by name (localInitializer covers variables only). */
export function findDeclaration(program: AstNode, name: string): AstNode | undefined {
  for (const raw of Array.isArray(program.body) ? program.body : []) {
    if (typeof raw !== "object" || raw === null) continue;
    const statement = raw as AstNode;
    const declaration =
      statement.type === "ExportNamedDeclaration" &&
      statement.declaration !== null &&
      typeof statement.declaration === "object"
        ? (statement.declaration as AstNode)
        : statement;
    if (
      (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
      identifierName(declaration.id) === name
    ) {
      return declaration;
    }
  }
  return undefined;
}

/** True when the module declares the name itself: a local shadow invalidates an import. */
export function isLocallyDeclared(file: ProjectFile, name: string): boolean {
  const body = Array.isArray(file.program.body) ? file.program.body : [];
  for (const raw of body) {
    if (typeof raw !== "object" || raw === null) continue;
    const statement = raw as AstNode;
    const declaration =
      statement.type === "ExportNamedDeclaration" &&
      statement.declaration !== null &&
      typeof statement.declaration === "object"
        ? (statement.declaration as AstNode)
        : statement;
    if (declarationNames(declaration).includes(name)) return true;
  }
  return false;
}

/** Stable diagnostic order (file, line, code, message) so snapshots never flap. */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].toSorted((left, right) => {
    const fileOrder = (left.source?.file ?? "").localeCompare(right.source?.file ?? "");
    if (fileOrder !== 0) return fileOrder;
    const lineOrder = (left.source?.line ?? 0) - (right.source?.line ?? 0);
    if (lineOrder !== 0) return lineOrder;
    const codeOrder = left.code.localeCompare(right.code);
    return codeOrder !== 0 ? codeOrder : left.message.localeCompare(right.message);
  });
}
