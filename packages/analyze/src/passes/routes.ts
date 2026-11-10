/**
 * Route files -> RouteFacts (docs/findings/ast-dsl-contract.md §3.1).
 *
 * A route is listed even when it does not use the wrapper: the graph is also the integrity
 * view, so an invalid route is reported instead of omitted. The filename is the only source
 * of method/path (Nitro's file router); the default export is the only source of the config.
 */

import { identifierName, unwrapExpression, type AstNode } from "../ast/node.ts";
import { error, info, warning } from "../diagnostics.ts";
import { defaultExportDeclaration } from "../module-info.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { ConfigFacts, Diagnostic, RouteFact, WrapperState } from "../types.ts";
import { routeConfigFacts } from "./route-config.ts";
import { scanElevations } from "./route-elevation.ts";
import { directDbWarnings, handlerReadsBody, handlerReadsForm } from "./route-handler.ts";
import { routeLocationFromFile } from "./route-location.ts";
import {
  defaultExportExpression,
  isLocallyDeclared,
  relativePath,
  sortDiagnostics,
} from "./static-read.ts";

const CORE_SPECIFIER = "@facilis/core";
const ROUTE_DIRS = ["server/routes/", "server/api/"];

export interface RouteResult {
  readonly routes: readonly RouteFact[];
  readonly diagnostics: readonly Diagnostic[];
}

interface WrapperResolution {
  readonly state: WrapperState;
  readonly call: AstNode | null;
  readonly reason: string;
}

/** The default export must be a `defineAuthorizedHandler(...)` call of the core import. */
function resolveWrapper(file: ProjectFile): WrapperResolution {
  const expression = defaultExportExpression(file);
  if (expression === undefined) {
    return { state: "invalid", call: null, reason: "the route file has no default export" };
  }
  if (expression.type !== "CallExpression") {
    return {
      state: "invalid",
      call: null,
      reason: "the default export is not a defineAuthorizedHandler() call",
    };
  }
  const callee = unwrapExpression(expression.callee);
  const name = callee?.type === "Identifier" ? identifierName(callee) : undefined;
  if (name === undefined) {
    return { state: "unknown", call: null, reason: "the handler callee cannot be resolved" };
  }
  if (isLocallyDeclared(file, name)) {
    return {
      state: "invalid",
      call: null,
      reason: '"' + name + '" is shadowed by a local declaration',
    };
  }
  const imported = file.module.imports.find((entry) => entry.local === name);
  if (
    imported === undefined ||
    imported.specifier !== CORE_SPECIFIER ||
    imported.imported !== "defineAuthorizedHandler"
  ) {
    return {
      state: "invalid",
      call: null,
      reason: "the default export is not the defineAuthorizedHandler import from @facilis/core",
    };
  }
  return { state: "valid", call: expression, reason: "" };
}

function scanRoute(
  graph: ModuleGraph,
  file: ProjectFile,
  config: ConfigFacts,
): { route: RouteFact | null; diagnostics: readonly Diagnostic[] } {
  const relative = relativePath(graph.root, file.path);
  const dir = ROUTE_DIRS.find((candidate) => relative.startsWith(candidate));
  const declaration = defaultExportDeclaration(file.program);
  const anchor = declaration?.start ?? 0;
  if (dir === undefined) return { route: null, diagnostics: [] };
  const location = routeLocationFromFile(relative.slice(dir.length));
  if (location === undefined) {
    return {
      route: null,
      diagnostics: [
        info(
          "unknown",
          "cannot derive a route method/path from the route file name",
          sourceRef(file.path, file.source, anchor),
        ),
      ],
    };
  }
  const wrapper = resolveWrapper(file);
  const ref = sourceRef(file.path, file.source, wrapper.call?.start ?? anchor);
  if (wrapper.state !== "valid" || wrapper.call === null) {
    return {
      route: {
        method: location.method,
        path: location.path,
        sourceFile: file.path,
        source: ref,
        wrapper: wrapper.state,
        permission: null,
        dbTables: null,
        dbColumns: null,
        description: null,
        input: { body: false, form: false, query: false, params: false },
        handlerBodyRead: false,
        handlerFormRead: false,
        elevations: [],
        unknown: [{ code: "route-wrapper", reason: wrapper.reason, source: ref }],
      },
      diagnostics: [error("route-wrapper", wrapper.reason, ref)],
    };
  }
  const facts = routeConfigFacts(graph, file, wrapper.call, config);
  const elevation = scanElevations(graph, file, wrapper.call);
  return {
    route: {
      method: location.method,
      path: location.path,
      sourceFile: file.path,
      source: ref,
      wrapper: "valid",
      permission: facts.permission,
      dbTables: facts.dbTables,
      dbColumns: facts.dbColumns,
      description: facts.description,
      input: facts.input,
      handlerBodyRead: handlerReadsBody(wrapper.call),
      handlerFormRead: handlerReadsForm(wrapper.call),
      elevations: elevation.facts,
      unknown: [...facts.unknown, ...elevation.unknown],
    },
    diagnostics: [
      ...facts.diagnostics,
      ...elevation.unknown.map((item) =>
        // An unreadable elevation cannot be shown in the graph; warn without blocking the route.
        warning(item.code, item.reason, item.source),
      ),
      ...directDbWarnings(file, ref),
    ],
  };
}

/** Read `server/routes/**` and `server/api/**` into route facts. */
export function buildRouteFacts(graph: ModuleGraph, config: ConfigFacts): RouteResult {
  const files = [...graph.files.values()]
    .filter((file) => ROUTE_DIRS.some((dir) => relativePath(graph.root, file.path).startsWith(dir)))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const routes: RouteFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const scanned = scanRoute(graph, file, config);
    if (scanned.route !== null) routes.push(scanned.route);
    diagnostics.push(...scanned.diagnostics);
  }
  routes.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.method.localeCompare(right.method) ||
      left.sourceFile.localeCompare(right.sourceFile),
  );
  return { routes, diagnostics: sortDiagnostics(diagnostics) };
}
