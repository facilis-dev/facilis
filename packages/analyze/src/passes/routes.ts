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
import { EMPTY_ROUTE_RELATIONS } from "../types-relations.ts";
import type { ConfigFacts, Diagnostic, RouteFact, WrapperState } from "../types.ts";
import { routeConfigFacts } from "./route-config.ts";
import { rawRouteConfigFacts } from "./route-config-raw.ts";
import { scanElevations } from "./route-elevation.ts";
import {
  directDbWarnings,
  handlerRawDbCalls,
  handlerReadsBody,
  handlerReadsForm,
} from "./route-handler.ts";
import { routeSurface } from "./surface-route.ts";
import { routeLocationFromFile } from "./route-location.ts";
import {
  defaultExportExpression,
  isLocallyDeclared,
  relativePath,
  sortDiagnostics,
} from "./static-read.ts";

const CORE_SPECIFIER = "@facilis.dev/core";
const ROUTE_DIRS = ["server/routes/", "server/api/"];

export interface RouteResult {
  readonly routes: readonly RouteFact[];
  readonly diagnostics: readonly Diagnostic[];
}

interface WrapperResolution {
  readonly state: WrapperState;
  readonly call: AstNode | null;
  readonly reason: string;
  /** Which DSL call produced the wrapper; raw routes have their own config contract. */
  readonly kind: "authorized" | "raw";
}

/** The two declared wrappers, both imported from @facilis.dev/core (D-226). */
const DECLARED_WRAPPERS: ReadonlyMap<string, "authorized" | "raw"> = new Map([
  ["defineAuthorizedHandler", "authorized"],
  ["defineRawRoute", "raw"],
]);

/** The default export must be a declared wrapper call of the core import (D-226). */
function resolveWrapper(file: ProjectFile): WrapperResolution {
  const expression = defaultExportExpression(file);
  if (expression === undefined) {
    return {
      state: "invalid",
      call: null,
      reason: "the route file has no default export",
      kind: "authorized",
    };
  }
  if (expression.type !== "CallExpression") {
    return {
      state: "invalid",
      call: null,
      reason: "the default export is not a defineAuthorizedHandler()/defineRawRoute() call",
      kind: "authorized",
    };
  }
  const callee = unwrapExpression(expression.callee);
  const name = callee?.type === "Identifier" ? identifierName(callee) : undefined;
  if (name === undefined) {
    return {
      state: "unknown",
      call: null,
      reason: "the handler callee cannot be resolved",
      kind: "authorized",
    };
  }
  if (isLocallyDeclared(file, name)) {
    return {
      state: "invalid",
      call: null,
      reason: '"' + name + '" is shadowed by a local declaration',
      kind: "authorized",
    };
  }
  const imported = file.module.imports.find((entry) => entry.local === name);
  const kind =
    imported !== undefined && imported.specifier === CORE_SPECIFIER && imported.imported !== null
      ? DECLARED_WRAPPERS.get(imported.imported)
      : undefined;
  if (kind === undefined) {
    return {
      state: "invalid",
      call: null,
      reason:
        "the default export is not a defineAuthorizedHandler/defineRawRoute import from @facilis.dev/core",
      kind: "authorized",
    };
  }
  return { state: "valid", call: expression, reason: "", kind };
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
          sourceRef(file.path, file.lines, anchor),
        ),
      ],
    };
  }
  const wrapper = resolveWrapper(file);
  const ref = sourceRef(file.path, file.lines, wrapper.call?.start ?? anchor);
  if (wrapper.state !== "valid" || wrapper.call === null) {
    return {
      route: {
        method: location.method,
        path: location.path,
        sourceFile: file.path,
        source: ref,
        wrapper: wrapper.state,
        permission: null,
        auth: null,
        crossSite: null,
        dbTables: null,
        dbColumns: null,
        rawSql: null,
        relations: EMPTY_ROUTE_RELATIONS,
        description: null,
        input: { body: false, form: false, query: false, params: false },
        handlerBodyRead: false,
        handlerFormRead: false,
        elevations: [],
        surface: {
          class: "undeclared",
          declarations: [],
          source: ref,
          unknown: [{ code: "route-wrapper", reason: wrapper.reason, source: ref }],
          rawSqlReason: null,
          rawDb: [],
        },
        unknown: [{ code: "route-wrapper", reason: wrapper.reason, source: ref }],
      },
      diagnostics: [error("route-wrapper", wrapper.reason, ref)],
    };
  }
  const elevation = scanElevations(graph, file, wrapper.call);
  const rawDb = handlerRawDbCalls(wrapper.call, file, ref);
  const elevationWarnings = elevation.unknown.map((item) =>
    // An unreadable elevation cannot be shown in the graph; warn without blocking the route.
    warning(item.code, item.reason, item.source),
  );
  if (wrapper.kind === "raw") {
    const facts = rawRouteConfigFacts(graph, file, wrapper.call, config);
    const classified = routeSurface({
      raw: true,
      rawReason: facts.reason,
      rawDeclared: facts.declared,
      ...(facts.confirmed === undefined ? {} : { rawConfirmed: facts.confirmed }),
      rawSql: false,
      rawSqlReason: null,
      rawDb: rawDb.calls,
      opaqueHandler: rawDb.opaque,
      source: ref,
      unknown: facts.unknown,
    });
    return {
      route: {
        method: location.method,
        path: location.path,
        sourceFile: file.path,
        source: ref,
        wrapper: "valid",
        permission: facts.permission,
        auth: facts.auth,
        crossSite: false,
        dbTables: facts.dbTables,
        dbColumns: facts.dbColumns,
        rawSql: false,
        relations: EMPTY_ROUTE_RELATIONS,
        description: facts.description,
        input: facts.input,
        handlerBodyRead: handlerReadsBody(wrapper.call),
        handlerFormRead: handlerReadsForm(wrapper.call),
        elevations: elevation.facts,
        surface: classified.surface,
        unknown: [...facts.unknown, ...elevation.unknown],
      },
      diagnostics: [
        ...facts.diagnostics,
        ...classified.diagnostics,
        ...elevationWarnings,
        ...directDbWarnings(file, ref),
      ],
    };
  }
  const facts = routeConfigFacts(graph, file, wrapper.call, config);
  const classified = routeSurface({
    raw: false,
    rawReason: null,
    rawDeclared: true,
    rawSql: facts.rawSql,
    rawSqlReason: facts.rawSqlReason,
    rawDb: rawDb.calls,
    opaqueHandler: rawDb.opaque,
    source: ref,
    unknown: facts.unknown,
  });
  return {
    route: {
      method: location.method,
      path: location.path,
      sourceFile: file.path,
      source: ref,
      wrapper: "valid",
      permission: facts.permission,
      auth: facts.permission !== null && facts.permission.length > 0 ? "required" : "none",
      crossSite: facts.crossSite,
      dbTables: facts.dbTables,
      dbColumns: facts.dbColumns,
      rawSql: facts.rawSql,
      relations: EMPTY_ROUTE_RELATIONS,
      description: facts.description,
      input: facts.input,
      handlerBodyRead: handlerReadsBody(wrapper.call),
      handlerFormRead: handlerReadsForm(wrapper.call),
      elevations: elevation.facts,
      surface: classified.surface,
      unknown: [...facts.unknown, ...elevation.unknown],
    },
    diagnostics: [
      ...facts.diagnostics,
      ...classified.diagnostics,
      ...elevationWarnings,
      ...directDbWarnings(file, ref),
    ],
  };
}

/** The `defineAuthorizedHandler(...)` call of a valid wrapper, for later passes (D-157). */
export function resolveWrapperCall(file: ProjectFile): AstNode | null {
  const wrapper = resolveWrapper(file);
  return wrapper.state === "valid" ? wrapper.call : null;
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
