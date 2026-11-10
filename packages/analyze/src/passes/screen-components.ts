/**
 * JSX component resolution for the static page preview: find a component's returned
 * expression and resolve a JSX name to a project file through the module graph.
 *
 * The resolver is deliberately one level deep per call; the preview builder owns the depth,
 * cycle and node budgets.
 */

import { asNode, nodeArray, type AstNode } from "../ast/node.ts";
import type { ModuleGraph } from "../module-graph.ts";
import { defaultExportDeclaration } from "../module-info.ts";
import { sourceRef } from "../source.ts";

export interface ComponentRef {
  readonly file: string;
  readonly name: string;
}

export function lineRef(
  graph: ModuleGraph,
  file: string,
  node: AstNode,
): { file: string; line: number } {
  const source = graph.file(file)?.source;
  return source === undefined
    ? { file, line: 1 }
    : sourceRef(file, source, typeof node.start === "number" ? node.start : 0);
}

function componentDeclaration(program: AstNode, name: string): AstNode | undefined {
  const wanted = name === "default" ? null : name;
  for (const statement of nodeArray(program, "body")) {
    const declaration =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
        ? asNode(statement.declaration)
        : statement;
    if (declaration === undefined) continue;
    if (declaration.type === "FunctionDeclaration") {
      const id = asNode(declaration.id);
      if (
        id !== undefined &&
        typeof id.name === "string" &&
        (wanted === null || id.name === wanted)
      ) {
        return declaration;
      }
    }
    if (declaration.type !== "VariableDeclaration") continue;
    for (const item of nodeArray(declaration, "declarations")) {
      const id = asNode(item.id);
      const init = asNode(item.init);
      if (id === undefined || init === undefined) continue;
      if (typeof id.name !== "string" || (wanted !== null && id.name !== wanted)) continue;
      if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        return init;
    }
  }
  if (name === "default") return defaultExportDeclaration(program);
  return undefined;
}

export function returnedExpression(body: AstNode): AstNode | undefined {
  if (body.type === "BlockStatement") {
    for (const statement of nodeArray(body, "body")) {
      const found = returnedExpression(statement);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (body.type === "ReturnStatement") return asNode(body.argument);
  if (body.type === "IfStatement") {
    const consequent = asNode(body.consequent);
    const alternate = asNode(body.alternate);
    return (
      (consequent === undefined ? undefined : returnedExpression(consequent)) ??
      (alternate === undefined ? undefined : returnedExpression(alternate))
    );
  }
  if (body.type === "TryStatement") {
    const block = asNode(body.block);
    const handler = asNode(body.handler);
    const finalizer = asNode(body.finalizer);
    const handlerBody = handler === undefined ? undefined : asNode(handler.body);
    return (
      (block === undefined ? undefined : returnedExpression(block)) ??
      (handlerBody === undefined ? undefined : returnedExpression(handlerBody)) ??
      (finalizer === undefined ? undefined : returnedExpression(finalizer))
    );
  }
  return undefined;
}

export function componentExpression(
  graph: ModuleGraph,
  filePath: string,
  name: string,
): AstNode | undefined {
  const file = graph.file(filePath);
  if (file === undefined) return undefined;
  const declaration = componentDeclaration(file.program, name);
  if (declaration === undefined) return undefined;
  if (declaration.type === "ArrowFunctionExpression") {
    const body = asNode(declaration.body);
    return body === undefined
      ? undefined
      : body.type === "BlockStatement"
        ? returnedExpression(body)
        : body;
  }
  if (declaration.type === "FunctionDeclaration" || declaration.type === "FunctionExpression") {
    const body = asNode(declaration.body);
    return body === undefined ? undefined : returnedExpression(body);
  }
  return declaration;
}

export function resolveComponent(
  graph: ModuleGraph,
  originFile: string,
  name: string,
): ComponentRef | null {
  const local = name.includes(".") ? name.slice(0, name.indexOf(".")) : name;
  const binding = graph.resolveBinding(originFile, local);
  if (binding === null) return null;
  const file = graph.file(binding.file);
  if (file === undefined) return null;
  return { file: file.path, name: binding.name };
}

export function firstComponentName(graph: ModuleGraph, filePath: string): string | null {
  const file = graph.file(filePath);
  if (file === undefined) return null;
  for (const statement of nodeArray(file.program, "body")) {
    const declaration =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
        ? asNode(statement.declaration)
        : statement;
    if (declaration === undefined) continue;
    if (declaration.type === "FunctionDeclaration") {
      const id = asNode(declaration.id);
      if (id !== undefined && typeof id.name === "string") return id.name;
    }
    if (declaration.type !== "VariableDeclaration") continue;
    for (const item of nodeArray(declaration, "declarations")) {
      const id = asNode(item.id);
      const init = asNode(item.init);
      if (id === undefined || init === undefined || typeof id.name !== "string") continue;
      if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        return id.name;
    }
  }
  return null;
}

export function canExpand(file: string): boolean {
  if (file.startsWith("src/components/ui/")) return false;
  return (
    file.startsWith("src/pages/") ||
    file.startsWith("src/layouts/") ||
    file.startsWith("src/components/")
  );
}
