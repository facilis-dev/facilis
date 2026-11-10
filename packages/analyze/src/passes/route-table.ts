/**
 * The explicit react-router route table (`src/app.tsx`): URL paths and their element trees.
 *
 * The generated frontend contract keeps routing in one file with no file-based magic
 * (docs/FRONTEND.md §2), so the table can be read statically. Only <Route>/<Routes> imported
 * from react-router-dom count; a local component with the same name is not routing.
 */

import { asNode, type AstNode } from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import { evaluateStatic } from "../static-eval.ts";
import type { SourceRef } from "../types.ts";
import { elementName, jsxAttribute, jsxAttributeValue, jsxChildren } from "./jsx.ts";

export interface RouteEntry {
  /** Normalized URL path; "*" for a catch-all route. */
  readonly path: string;
  /** The route's element JSX, when it is a JSX element rather than a component reference. */
  readonly element: AstNode | null;
  /** Index of the parent route entry (pathless layout routes are entries too). */
  readonly parentIndex: number | null;
  readonly source: SourceRef;
}

function normalizePath(value: string): string {
  if (value === "*") return "*";
  const withSlash = value.startsWith("/") ? value : "/" + value;
  const collapsed = withSlash.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

function joinPath(parent: string | null, child: string): string {
  if (child.startsWith("/") || child === "*") return normalizePath(child);
  const base = parent === null || parent === "/" ? "" : parent.replace(/\/+$/, "");
  return normalizePath(base + "/" + child);
}

function stringAttribute(
  node: AstNode,
  name: string,
  graph: ModuleGraph,
  file: ProjectFile,
): string | null {
  const value = jsxAttributeValue(jsxAttribute(node, name));
  if (value === undefined) return null;
  const evaluated = evaluateStatic(value, { graph, file: file.path });
  return evaluated.ok && typeof evaluated.value === "string" ? evaluated.value : null;
}

function importedLocals(file: ProjectFile, imported: "Routes" | "Route"): ReadonlySet<string> {
  const names = new Set<string>();
  for (const entry of file.module.imports) {
    if (entry.specifier !== "react-router-dom") continue;
    if ((entry.imported ?? "default") !== imported) continue;
    names.add(entry.local);
  }
  return names;
}

function findRoutesElement(file: ProjectFile, locals: ReadonlySet<string>): AstNode | null {
  let found: AstNode | null = null;
  walk(file.program, (node) => {
    if (found !== null || node.type !== "JSXElement") return;
    const name = elementName(node);
    if (name !== null && locals.has(name)) found = node;
  });
  return found;
}

/** Read the route table from the project's app file (empty when absent or unreadable). */
export function buildRouteTable(graph: ModuleGraph, file: ProjectFile): readonly RouteEntry[] {
  const routesLocals = importedLocals(file, "Routes");
  const routeLocals = importedLocals(file, "Route");
  if (routesLocals.size === 0 || routeLocals.size === 0) return [];
  const routes = findRoutesElement(file, routesLocals);
  if (routes === null) return [];
  const entries: RouteEntry[] = [];

  const parseRoute = (
    node: AstNode,
    parentIndex: number | null,
    parentPath: string | null,
  ): void => {
    const pathValue = stringAttribute(node, "path", graph, file);
    const isIndex = jsxAttribute(node, "index") !== undefined;
    const path = pathValue === null ? (parentPath ?? "/") : joinPath(parentPath, pathValue);
    const finalPath = isIndex ? (parentPath ?? "/") : path;
    const element = asNode(jsxAttributeValue(jsxAttribute(node, "element")));
    const index = entries.length;
    entries.push({
      path: finalPath,
      element: element !== undefined && element.type === "JSXElement" ? element : null,
      parentIndex,
      source: sourceRef(file.path, file.source, typeof node.start === "number" ? node.start : 0),
    });
    for (const child of jsxChildren(node)) {
      if (child.type === "JSXElement" && routeLocals.has(elementName(child) ?? "")) {
        parseRoute(child, index, finalPath);
      } else if (child.type === "JSXFragment") {
        for (const nested of jsxChildren(child)) {
          if (nested.type === "JSXElement" && routeLocals.has(elementName(nested) ?? "")) {
            parseRoute(nested, index, finalPath);
          }
        }
      }
    }
  };

  for (const child of jsxChildren(routes)) {
    if (child.type === "JSXElement" && routeLocals.has(elementName(child) ?? "")) {
      parseRoute(child, null, null);
    } else if (child.type === "JSXFragment") {
      for (const nested of jsxChildren(child)) {
        if (nested.type === "JSXElement" && routeLocals.has(elementName(nested) ?? "")) {
          parseRoute(nested, null, null);
        }
      }
    }
  }
  return entries;
}
