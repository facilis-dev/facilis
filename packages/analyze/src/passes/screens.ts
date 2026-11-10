/**
 * Static screen facts for the project graph: route-table paths, a bounded component preview
 * per page and explicit page-to-page navigation links.
 *
 * Only explicit client navigation counts (react-router `Link`, `NavLink`, `useNavigate`).
 * Guards and `<Navigate>` redirects are intentionally out of scope for the graph: they are
 * conditional control flow, not a link the page declares.
 */

import { asNode, nodeArray, unwrapExpression, type AstNode } from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { evaluateStatic } from "../static-eval.ts";
import type { PageFact, PageLink, PagePreview, ScreenFacts } from "../types.ts";
import { elementName, jsxAttribute, jsxAttributeValue } from "./jsx.ts";
import { buildRouteTable, type RouteEntry } from "./route-table.ts";
import { buildPagePreview, pageComponentName, type PreviewRoot } from "./screen-preview.ts";

function resolvePage(graph: ModuleGraph, originFile: string, name: string): string | null {
  const local = name.includes(".") ? name.slice(0, name.indexOf(".")) : name;
  const binding = graph.resolveBinding(originFile, local);
  if (binding === null) return null;
  const file = graph.file(binding.file);
  return file !== undefined && file.path.startsWith("src/pages/") ? file.path : null;
}

/** First component in a route element that resolves to a file under src/pages/. */
function pagePathOfElement(
  graph: ModuleGraph,
  originFile: string,
  element: AstNode,
): string | null {
  let found: string | null = null;
  walk(element, (node) => {
    if (found !== null || node.type !== "JSXElement") return;
    const name = elementName(node);
    if (name === null || name[0] === name[0]?.toLowerCase()) return;
    found = resolvePage(graph, originFile, name);
  });
  return found;
}

function appFileOf(graph: ModuleGraph): ProjectFile | null {
  const direct = graph.file("src/app.tsx");
  if (direct !== undefined) return direct;
  for (const file of graph.files.values()) {
    if (!file.path.startsWith("src/")) continue;
    if (buildRouteTable(graph, file).length > 0) return file;
  }
  return null;
}

/** Only page/layout/app components own page links; providers and guards are shared chrome. */
function isLinkSourceFile(file: string): boolean {
  if (file.startsWith("src/components/ui/")) return false;
  return (
    file.startsWith("src/pages/") ||
    file.startsWith("src/layouts/") ||
    file.startsWith("src/components/")
  );
}

interface PageRoute {
  readonly index: number;
  readonly path: string;
}

function routesByPage(
  graph: ModuleGraph,
  appFile: ProjectFile,
  entries: readonly RouteEntry[],
): Map<string, PageRoute[]> {
  const byPage = new Map<string, PageRoute[]>();
  entries.forEach((entry, index) => {
    if (entry.element === null) return;
    const pagePath = pagePathOfElement(graph, appFile.path, entry.element);
    if (pagePath === null) return;
    const list = byPage.get(pagePath) ?? [];
    list.push({ index, path: entry.path });
    byPage.set(pagePath, list);
  });
  return byPage;
}

function previewRoot(
  entries: readonly RouteEntry[],
  pageEntry: number,
  appPath: string,
): PreviewRoot | null {
  let root: PreviewRoot | null = null;
  let current: number | null = pageEntry;
  while (current !== null) {
    const entry: RouteEntry | undefined = entries[current];
    if (entry === undefined) break;
    if (entry.element !== null) {
      root = { element: entry.element, originFile: appPath, outletChild: root };
    }
    current = entry.parentIndex;
  }
  return root;
}

function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function pathMatches(pattern: string, target: string): boolean {
  if (pattern === target) return true;
  if (pattern === "*") return false;
  const patternParts = pathSegments(pattern);
  const targetParts = pathSegments(target);
  if (patternParts.length !== targetParts.length) return false;
  return patternParts.every((part, index) => {
    if (part === "*") return true;
    if (part.startsWith(":") || (part.startsWith("{") && part.endsWith("}"))) return true;
    return part === targetParts[index];
  });
}

function targetPathOf(
  node: AstNode | undefined,
  graph: ModuleGraph,
  file: ProjectFile,
): string | null {
  if (node === undefined) return null;
  const evaluated = evaluateStatic(node, { graph, file: file.path });
  if (!evaluated.ok) return null;
  const value = evaluated.value;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "pathname" in value) {
    const pathname = (value as { pathname?: unknown }).pathname;
    return typeof pathname === "string" ? pathname : null;
  }
  return null;
}

function stripLocation(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

interface LinkBindings {
  readonly links: ReadonlyMap<string, "link" | "navlink">;
  readonly navigate: ReadonlySet<string>;
}

function linkBindings(file: ProjectFile): LinkBindings {
  const links = new Map<string, "link" | "navlink">();
  const useNavigate = new Set<string>();
  for (const imported of file.module.imports) {
    if (imported.specifier !== "react-router-dom") continue;
    if (imported.imported === "Link") links.set(imported.local, "link");
    if (imported.imported === "NavLink") links.set(imported.local, "navlink");
    if (imported.imported === "useNavigate") useNavigate.add(imported.local);
  }
  const navigate = new Set<string>();
  if (useNavigate.size === 0) return { links, navigate };
  walk(file.program, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const id = asNode(node.id);
    const init = unwrapExpression(asNode(node.init));
    if (id === undefined || typeof id.name !== "string" || init === undefined) return;
    if (init.type !== "CallExpression") return;
    const callee = unwrapExpression(init.callee);
    if (
      callee?.type === "Identifier" &&
      useNavigate.has(typeof callee.name === "string" ? callee.name : "")
    ) {
      navigate.add(id.name);
    }
  });
  return { links, navigate };
}

function linksInFile(
  graph: ModuleGraph,
  file: ProjectFile,
): { to: string; kind: "link" | "navlink" | "navigate"; source: { file: string; line: number } }[] {
  const bindings = linkBindings(file);
  if (bindings.links.size === 0 && bindings.navigate.size === 0) return [];
  const found: {
    to: string;
    kind: "link" | "navlink" | "navigate";
    source: { file: string; line: number };
  }[] = [];
  walk(file.program, (node) => {
    if (node.type === "JSXElement") {
      const name = elementName(node);
      const kind = name === null ? undefined : bindings.links.get(name);
      if (kind === undefined) return;
      const value = jsxAttributeValue(jsxAttribute(node, "to"));
      const to = targetPathOf(value, graph, file);
      if (to !== null) {
        found.push({ to, kind, source: lineOf(file, node) });
      }
      return;
    }
    if (node.type !== "CallExpression") return;
    const callee = unwrapExpression(node.callee);
    if (callee?.type !== "Identifier" || typeof callee.name !== "string") return;
    if (!bindings.navigate.has(callee.name)) return;
    const to = targetPathOf(nodeArray(node, "arguments")[0], graph, file);
    if (to !== null) found.push({ to, kind: "navigate", source: lineOf(file, node) });
  });
  return found;
}

function lineOf(file: ProjectFile, node: AstNode): { file: string; line: number } {
  const offset = typeof node.start === "number" ? node.start : 0;
  let line = 1;
  for (let index = 0; index < offset && index < file.source.length; index += 1) {
    if (file.source.charCodeAt(index) === 10) line += 1;
  }
  return { file: file.path, line };
}

/** Build route paths, page previews and explicit page links from the project snapshot. */
export function buildScreens(graph: ModuleGraph, pages: readonly PageFact[]): ScreenFacts {
  const appFile = appFileOf(graph);
  const entries = appFile === null ? [] : buildRouteTable(graph, appFile);
  const byPage =
    appFile === null ? new Map<string, PageRoute[]>() : routesByPage(graph, appFile, entries);
  const pathToPage = new Map<string, string>();
  for (const entry of entries) {
    if (entry.element === null || appFile === null) continue;
    const pagePath = pagePathOfElement(graph, appFile.path, entry.element);
    if (pagePath !== null && !pathToPage.has(entry.path)) pathToPage.set(entry.path, pagePath);
  }
  const resolveTarget = (target: string): string | null => {
    const path = stripLocation(target);
    if (!path.startsWith("/") && path !== "*") return null;
    const exact = pathToPage.get(path);
    if (exact !== undefined) return exact;
    for (const entry of entries) {
      if (!pathMatches(entry.path, path)) continue;
      if (entry.element === null || appFile === null) continue;
      const pagePath = pagePathOfElement(graph, appFile.path, entry.element);
      if (pagePath !== null) return pagePath;
    }
    return null;
  };

  const previews: Record<string, PagePreview> = {};
  for (const page of pages) {
    if (page.kind !== "page") continue;
    const pageRoutes = byPage.get(page.path) ?? [];
    const first = pageRoutes[0];
    const root =
      appFile === null || first === undefined
        ? null
        : previewRoot(entries, first.index, appFile.path);
    previews[page.path] = buildPagePreview({
      graph,
      pagePath: page.path,
      root,
      pageName: root === null ? pageComponentName(graph, page.path) : null,
      routePaths: pageRoutes.map((entry) => entry.path),
    });
  }

  const links: PageLink[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (page.kind !== "page") continue;
    const preview = previews[page.path];
    const files = new Set<string>([page.path]);
    for (const node of preview?.nodes ?? []) {
      if (node.file !== null && isLinkSourceFile(node.file)) files.add(node.file);
    }
    for (const filePath of files) {
      const file = graph.file(filePath);
      if (file === undefined) continue;
      for (const link of linksInFile(graph, file)) {
        const target = resolveTarget(link.to);
        if (target === null || target === page.path) continue;
        const key = page.path + "\u0000" + target + "\u0000" + link.kind + "\u0000" + link.to;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({
          from: page.path,
          to: target,
          toPath: stripLocation(link.to),
          kind: link.kind,
          source: link.source,
        });
      }
    }
  }

  return { previews, links };
}
