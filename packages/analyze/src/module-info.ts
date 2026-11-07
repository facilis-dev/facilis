import { identifierName, isAstNode, literalString, nodeArray, type AstNode } from "./ast/node.ts";
import type { SourceRef } from "./types.ts";

export interface ImportBinding {
  readonly specifier: string;
  readonly imported: string | null;
  readonly local: string;
  readonly kind: "named" | "default" | "namespace";
  readonly source: SourceRef;
}

export interface ExportBinding {
  readonly exported: string;
  readonly local: string | null;
  readonly source: string | null;
  readonly imported: string | null;
  readonly kind: "named" | "default" | "reexport" | "all";
  readonly ref: SourceRef;
}

export interface ModuleInfo {
  readonly imports: readonly ImportBinding[];
  readonly exports: readonly ExportBinding[];
}

function refOf(file: string, source: string, node: AstNode): SourceRef {
  const offset = typeof node.start === "number" ? node.start : 0;
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return { file, line };
}

function importBindings(file: string, source: string, program: AstNode): ImportBinding[] {
  const out: ImportBinding[] = [];
  for (const statement of nodeArray(program, "body")) {
    if (statement.type !== "ImportDeclaration") continue;
    const specifier = literalString(statement.source);
    if (specifier === undefined) continue;
    const ref = refOf(file, source, statement);
    for (const item of nodeArray(statement, "specifiers")) {
      if (item.type === "ImportDefaultSpecifier") {
        const local = identifierName(item.local);
        if (local !== undefined) {
          out.push({ specifier, imported: "default", local, kind: "default", source: ref });
        }
      } else if (item.type === "ImportNamespaceSpecifier") {
        const local = identifierName(item.local);
        if (local !== undefined) {
          out.push({ specifier, imported: null, local, kind: "namespace", source: ref });
        }
      } else if (item.type === "ImportSpecifier") {
        const local = identifierName(item.local);
        const imported = identifierName(item.imported) ?? literalString(item.imported);
        if (local !== undefined && imported !== undefined) {
          out.push({ specifier, imported, local, kind: "named", source: ref });
        }
      }
    }
  }
  return out;
}

export function declarationNames(declaration: AstNode): string[] {
  if (declaration.type === "VariableDeclaration") {
    return nodeArray(declaration, "declarations")
      .map((item) => identifierName(item.id))
      .filter((name): name is string => name !== undefined);
  }
  if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
    const name = identifierName(declaration.id);
    return name === undefined ? [] : [name];
  }
  return [];
}

function exportBindings(file: string, source: string, program: AstNode): ExportBinding[] {
  const out: ExportBinding[] = [];
  for (const statement of nodeArray(program, "body")) {
    const ref = refOf(file, source, statement);
    if (statement.type === "ExportDefaultDeclaration") {
      const declaration = isAstNode(statement.declaration) ? statement.declaration : undefined;
      const local = declaration === undefined ? null : (identifierName(declaration) ?? null);
      out.push({ exported: "default", local, source: null, imported: null, kind: "default", ref });
      continue;
    }
    if (statement.type === "ExportAllDeclaration") {
      const specifier = literalString(statement.source);
      if (specifier !== undefined) {
        out.push({
          exported: "*",
          local: null,
          source: specifier,
          imported: null,
          kind: "all",
          ref,
        });
      }
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = isAstNode(statement.declaration) ? statement.declaration : undefined;
    if (declaration !== undefined) {
      for (const name of declarationNames(declaration)) {
        out.push({ exported: name, local: name, source: null, imported: null, kind: "named", ref });
      }
    }
    const from = literalString(statement.source);
    for (const item of nodeArray(statement, "specifiers")) {
      if (item.type !== "ExportSpecifier") continue;
      const exported = identifierName(item.exported) ?? literalString(item.exported);
      const local = identifierName(item.local) ?? literalString(item.local);
      if (exported === undefined || local === undefined) continue;
      out.push({
        exported,
        local: from === undefined ? local : null,
        source: from ?? null,
        imported: from === undefined ? null : local,
        kind: from === undefined ? "named" : "reexport",
        ref,
      });
    }
  }
  return out;
}

export function parseModuleInfo(file: string, source: string, program: AstNode): ModuleInfo {
  return {
    imports: importBindings(file, source, program),
    exports: exportBindings(file, source, program),
  };
}

/** The declaration of "export default ...", unwrapped from the export statement. */
export function defaultExportDeclaration(program: AstNode): AstNode | undefined {
  for (const statement of nodeArray(program, "body")) {
    if (statement.type !== "ExportDefaultDeclaration") continue;
    return isAstNode(statement.declaration) ? statement.declaration : undefined;
  }
  return undefined;
}

/** The initializer of a top-level const/let/var binding, when declared exactly once. */
export function localInitializer(program: AstNode, name: string): AstNode | undefined {
  let found: AstNode | undefined;
  for (const statement of nodeArray(program, "body")) {
    const declaration =
      statement.type === "VariableDeclaration"
        ? statement
        : statement.type === "ExportNamedDeclaration" && isAstNode(statement.declaration)
          ? statement.declaration
          : undefined;
    if (declaration === undefined || declaration.type !== "VariableDeclaration") continue;
    for (const item of nodeArray(declaration, "declarations")) {
      if (identifierName(item.id) !== name) continue;
      if (found !== undefined) return undefined;
      found = isAstNode(item.init) ? item.init : undefined;
    }
  }
  return found;
}
