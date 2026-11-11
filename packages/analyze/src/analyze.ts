import { buildPageFacts, type TransportSpec } from "./passes/clients.ts";
import { buildConfigFacts } from "./passes/config.ts";
import { buildFileFacts } from "./passes/file-facts.ts";
import { readLocaleCatalogs } from "./passes/i18n.ts";
import { buildRouteFacts } from "./passes/routes.ts";
import { buildRouteRelationFacts } from "./passes/route-relations.ts";
import { routeSystemTableDiagnostics } from "./passes/route-tables.ts";
import { buildSchemaFacts } from "./passes/schema.ts";
import { buildScreens } from "./passes/screens.ts";
import { buildViewFacts } from "./passes/views.ts";
import { buildProjectGraph } from "./graph.ts";
import { createModuleGraph, type ModuleGraph } from "./module-graph.ts";
import type { PathAlias } from "./path-resolver.ts";
import type { Parser } from "./parser.ts";
import { computeRevision } from "./revision.ts";
import { diagnostic } from "./diagnostics.ts";
import type { Analysis, Diagnostic } from "./types.ts";

export interface AnalyzeInput {
  /** Project-relative path -> source. The analyzer never touches the filesystem itself. */
  readonly files: ReadonlyMap<string, string>;
  readonly parser: Parser;
  /** Project root inside the file map (defaults to the map root). */
  readonly rootDir?: string;
  readonly aliases?: readonly PathAlias[];
  readonly transport?: TransportSpec;
}

/** The sanctioned client transport (docs/findings/ast-dsl-contract.md §3.4). */
export const DEFAULT_TRANSPORT: TransportSpec = {
  module: "src/lib/api.ts",
  exportName: "api",
};

/** Analyze a project snapshot into the fact model + project graph. Pure and synchronous. */
export function analyzeProject(input: AnalyzeInput): Analysis {
  const graph: ModuleGraph = createModuleGraph({
    files: input.files,
    parser: input.parser,
    root: input.rootDir ?? "",
    ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
  });
  const config = buildConfigFacts(graph);
  const routes = buildRouteFacts(graph, config.facts);
  const schema = buildSchemaFacts(graph, config.facts);
  const views = buildViewFacts(graph);
  // D-157: the declaration check runs after the schema and the views, because a route's
  // `dbTables` and its usage are compared against both (tables and views).
  const routeRelations = buildRouteRelationFacts(graph, routes.routes, schema.tables, views.views);
  const locales = readLocaleCatalogs(graph);
  const pages = buildPageFacts(graph, routes.routes, input.transport ?? DEFAULT_TRANSPORT);
  const screens = buildScreens(graph, pages.pages);
  const fileFacts = buildFileFacts(graph);

  const diagnostics: Diagnostic[] = [];
  for (const file of graph.files.values()) {
    for (const error of file.errors) {
      diagnostics.push(diagnostic("parse-error", "error", error.message, error.source));
    }
  }
  diagnostics.push(
    ...[
      ...config.diagnostics,
      ...routes.diagnostics,
      ...schema.diagnostics,
      ...views.diagnostics,
      ...routeRelations.diagnostics,
      ...locales.diagnostics,
      ...pages.diagnostics,
      ...routeSystemTableDiagnostics(routes.routes, schema.tables),
    ].filter(
      // Framework sources are shipped code: their facts stay, but their lint-style
      // diagnostics are not the project's. Project files start outside node_modules/.
      (entry) => entry.source === null || !entry.source.file.startsWith("node_modules/"),
    ),
  );

  return {
    revision: computeRevision(input.files),
    files: [...graph.files.keys()].toSorted((left, right) => left.localeCompare(right)),
    config: config.facts,
    routes: routeRelations.routes,
    tables: schema.tables,
    relations: schema.relations,
    views: views.views,
    pages: pages.pages,
    fileFacts,
    locales: locales.locales,
    diagnostics,
    graph: buildProjectGraph({
      routes: routes.routes,
      tables: schema.tables,
      relations: schema.relations,
      pages: pages.pages,
      screens,
    }),
  };
}
