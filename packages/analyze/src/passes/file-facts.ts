/**
 * Per-file module facts: imports, re-exports, dynamic imports/requires and literal `t()`
 * keys (docs/findings/ast-dsl-contract.md §3.6).
 *
 * These are the AST replacement for the patch validator's tolerant text scans: the rules
 * need the module graph edges and the translation keys of a source file, and they must be
 * readable without executing the project. The parser produced the structure; this pass only
 * reads it, so a construct outside the static subset is simply absent rather than guessed.
 */

import { identifierName, literalString, nodeArray, type AstNode } from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { CallFact, FileFacts, ImportFact, SourceRef, TranslationCallFact } from "../types.ts";

function refOf(file: ProjectFile, node: AstNode): SourceRef {
  const offset = typeof node.start === "number" ? node.start : 0;
  return sourceRef(file.path, file.source, offset);
}

function push(
  imports: ImportFact[],
  specifier: string,
  kind: ImportFact["kind"],
  local: string | null,
  imported: string | null,
  source: SourceRef,
): void {
  imports.push({ specifier, kind, local, imported, source });
}

function declarationImports(file: ProjectFile): ImportFact[] {
  const imports: ImportFact[] = [];
  for (const statement of nodeArray(file.program, "body")) {
    if (statement.type === "ImportDeclaration") {
      const specifier = literalString(statement.source);
      if (specifier === undefined) continue;
      const source = refOf(file, statement);
      const specifiers = nodeArray(statement, "specifiers");
      if (specifiers.length === 0) {
        push(imports, specifier, "side-effect", null, null, source);
        continue;
      }
      for (const item of specifiers) {
        const local = identifierName(item.local);
        if (local === undefined) continue;
        if (item.type === "ImportDefaultSpecifier") {
          push(imports, specifier, "default", local, "default", source);
        } else if (item.type === "ImportNamespaceSpecifier") {
          push(imports, specifier, "namespace", local, null, source);
        } else if (item.type === "ImportSpecifier") {
          const imported = identifierName(item.imported) ?? literalString(item.imported);
          if (imported !== undefined) push(imports, specifier, "named", local, imported, source);
        }
      }
      continue;
    }
    if (
      statement.type === "ExportAllDeclaration" ||
      (statement.type === "ExportNamedDeclaration" && statement.source !== null)
    ) {
      const specifier = literalString(statement.source);
      if (specifier !== undefined) {
        push(imports, specifier, "export-from", null, null, refOf(file, statement));
      }
    }
  }
  return imports;
}

function expressionImports(file: ProjectFile): ImportFact[] {
  const imports: ImportFact[] = [];
  walk(file.program, (node) => {
    if (node.type === "ImportExpression") {
      const specifier = literalString(node.source);
      if (specifier !== undefined)
        push(imports, specifier, "dynamic", null, null, refOf(file, node));
      return;
    }
    if (node.type === "CallExpression" && identifierName(node.callee) === "require") {
      const specifier = literalString(nodeArray(node, "arguments")[0]);
      if (specifier !== undefined)
        push(imports, specifier, "require", null, null, refOf(file, node));
    }
  });
  return imports;
}

function templateString(node: AstNode | undefined): string | undefined {
  if (node === undefined || node.type !== "TemplateLiteral") return undefined;
  const quasis = nodeArray(node, "quasis");
  if (quasis.length !== 1) return undefined;
  const value = quasis[0]?.value;
  if (typeof value !== "object" || value === null) return undefined;
  const cooked = (value as { cooked?: unknown }).cooked;
  if (typeof cooked === "string") return cooked;
  const raw = (value as { raw?: unknown }).raw;
  return typeof raw === "string" ? raw : undefined;
}

function translationCalls(file: ProjectFile): TranslationCallFact[] {
  const calls: TranslationCallFact[] = [];
  walk(file.program, (node) => {
    if (node.type !== "CallExpression" || identifierName(node.callee) !== "t") return;
    const argument = nodeArray(node, "arguments")[0];
    const key = literalString(argument) ?? templateString(argument);
    if (key !== undefined) calls.push({ key, source: refOf(file, node) });
  });
  return calls;
}

function bareCalls(file: ProjectFile): CallFact[] {
  const calls: CallFact[] = [];
  walk(file.program, (node) => {
    if (node.type !== "CallExpression") return;
    const name = identifierName(node.callee);
    if (name !== undefined) calls.push({ name, source: refOf(file, node) });
  });
  return calls;
}

function byPosition(left: ImportFact, right: ImportFact): number {
  return (
    left.source.line - right.source.line ||
    left.specifier.localeCompare(right.specifier) ||
    left.kind.localeCompare(right.kind)
  );
}

/** Read the module facts of every parsed source file, in path order. */
export function buildFileFacts(graph: ModuleGraph): readonly FileFacts[] {
  const files = [...graph.files.values()].toSorted((left, right) =>
    left.path.localeCompare(right.path),
  );
  return files.map((file) => ({
    path: file.path,
    imports: [...declarationImports(file), ...expressionImports(file)].toSorted(byPosition),
    translationCalls: translationCalls(file),
    calls: bareCalls(file),
  }));
}
