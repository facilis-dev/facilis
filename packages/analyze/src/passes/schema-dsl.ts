import {
  identifierName,
  isAstNode,
  memberName,
  nodeArray,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { diagnostic } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { Diagnostic, Severity, SourceRef, UnknownFact } from "../types.ts";

/** Package a DSL symbol came from; calls are classified by import specifier, never by name. */
export type DslPackage = "pg-core" | "drizzle-orm" | "facilis-db";

export interface DslSymbol {
  readonly name: string;
  readonly pkg: DslPackage;
}

/** Resolves a callee expression to a whitelisted DSL symbol imported from a known package. */
export type DslResolver = (callee: unknown) => DslSymbol | null;

function packageOf(specifier: string): DslPackage | null {
  if (specifier === "drizzle-orm/pg-core" || specifier.startsWith("drizzle-orm/pg-core/")) {
    return "pg-core";
  }
  if (specifier === "drizzle-orm" || specifier.startsWith("drizzle-orm/")) return "drizzle-orm";
  if (specifier === "@facilis.dev/db" || specifier.startsWith("@facilis.dev/db/")) return "facilis-db";
  return null;
}

/** Package classification for an aliased specifier that resolved into an installed package. */
function packageOfResolved(path: string): DslPackage | null {
  if (path.includes("node_modules/drizzle-orm/pg-core/")) return "pg-core";
  if (path.includes("node_modules/drizzle-orm/")) return "drizzle-orm";
  if (path.includes("node_modules/@facilis.dev/db/")) return "facilis-db";
  return null;
}

export function createDslResolver(graph: ModuleGraph, file: ProjectFile): DslResolver {
  const named = new Map<string, DslSymbol>();
  const namespaces = new Map<string, DslPackage>();
  for (const imported of file.module.imports) {
    let pkg = packageOf(imported.specifier);
    if (pkg === null) {
      const resolved = graph.resolve(file.path, imported.specifier);
      if (resolved !== null) pkg = packageOfResolved(resolved);
    }
    if (pkg === null) continue;
    if (imported.kind === "namespace") {
      namespaces.set(imported.local, pkg);
      continue;
    }
    if (imported.kind !== "named" || imported.imported === null) continue;
    named.set(imported.local, { name: imported.imported, pkg });
  }
  return (callee) => {
    const node = unwrapExpression(callee);
    if (node === undefined) return null;
    if (node.type === "Identifier") {
      const local = identifierName(node);
      return local === undefined ? null : (named.get(local) ?? null);
    }
    if (node.type !== "MemberExpression" || node.computed === true) return null;
    const namespace = identifierName(unwrapExpression(node.object));
    const pkg = namespace === undefined ? undefined : namespaces.get(namespace);
    const name = memberName(node);
    if (pkg === undefined || name === undefined) return null;
    return { name, pkg };
  };
}

/** Variable declarators at module top level, including `export const ...`. */
export function topLevelDeclarators(program: AstNode): AstNode[] {
  const out: AstNode[] = [];
  for (const statement of nodeArray(program, "body")) {
    const declaration =
      statement.type === "VariableDeclaration"
        ? statement
        : statement.type === "ExportNamedDeclaration" && isAstNode(statement.declaration)
          ? statement.declaration
          : undefined;
    if (declaration === undefined || declaration.type !== "VariableDeclaration") continue;
    out.push(...nodeArray(declaration, "declarations"));
  }
  return out;
}

/** The expression a callback returns; supports `() => x` and `() => { return x; }`. */
export function callbackExpression(callback: AstNode | undefined): AstNode | undefined {
  const fn = unwrapExpression(callback);
  if (fn === undefined) return undefined;
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return undefined;
  const body = unwrapExpression(fn.body);
  if (body === undefined || body.type !== "BlockStatement") return body;
  const returns = nodeArray(body, "body").filter(
    (statement) => statement.type === "ReturnStatement",
  );
  const statement = returns.length === 1 ? returns[0] : undefined;
  return statement === undefined ? undefined : unwrapExpression(statement.argument);
}

export function nodeRef(file: ProjectFile, node: AstNode | undefined): SourceRef {
  return sourceRef(file.path, file.source, typeof node?.start === "number" ? node.start : 0);
}

/** Schema DSL files live under the project's `db/` directory (root-aware). */
export function isSchemaFile(graph: ModuleGraph, path: string): boolean {
  const prefix = graph.root.length === 0 ? "db/" : graph.root + "/db/";
  return path.startsWith(prefix);
}

/** View declarations live under `db/views/` (SPEC §11.2, D-157). */
export function isViewFile(graph: ModuleGraph, path: string): boolean {
  const prefix = graph.root.length === 0 ? "db/views/" : graph.root + "/db/views/";
  return path.startsWith(prefix);
}

export function schemaUnknown(reason: string, source: SourceRef): UnknownFact {
  return { code: "schema-static", reason, source };
}

function severityOf(code: string): Severity {
  if (code === "fk-target-known") return "warning";
  if (code === "unknown") return "info";
  return "error";
}

/** Unknowns are also diagnostics: the fact model never hides what the interpreter could not read. */
export function schemaDiagnostics(unknowns: readonly UnknownFact[]): Diagnostic[] {
  return unknowns.map((unknown) =>
    diagnostic(unknown.code, severityOf(unknown.code), unknown.reason, unknown.source),
  );
}
