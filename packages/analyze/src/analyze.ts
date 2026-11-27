import { buildPageFacts, type TransportSpec } from "./passes/clients.ts";
import { buildConfigFacts } from "./passes/config.ts";
import { buildPrerenderFacts } from "./passes/prerender.ts";
import {
  NO_PRERENDER_DECLARATION,
  readVitePrerenderDeclaration,
  type PrerenderDeclaration,
} from "./passes/prerender-vite.ts";
import { buildFileFacts } from "./passes/file-facts.ts";
import { readLocaleCatalogs } from "./passes/i18n.ts";
import { dynamicTranslationKeyDiagnostics } from "./passes/i18n-keys.ts";
import { buildJobFacts } from "./passes/jobs.ts";
import { buildJobRelationFacts } from "./passes/job-relations.ts";
import { buildRouteFacts } from "./passes/routes.ts";
import { noDirectEnvDiagnostics } from "./passes/no-direct-env.ts";
import { runtimeConfigDiagnostics } from "./passes/runtime-access.ts";
import { buildRouteRelationFacts } from "./passes/route-relations.ts";
import { buildSecuritySurfaceFacts } from "./passes/surface.ts";
import { importCycleDiagnostics } from "./passes/import-cycle.ts";
import { reservedRoutePrefixDiagnostics } from "./passes/route-reserved-prefix.ts";
import { routeGetEffectDiagnostics } from "./passes/route-get-effects.ts";
import { rawSqlSystemWriteDiagnostics } from "./passes/raw-sql-system-write.ts";
import { routeSystemTableDiagnostics } from "./passes/route-tables.ts";
import { buildSchemaFacts } from "./passes/schema.ts";
import { buildScreens } from "./passes/screens.ts";
import { buildViewFacts } from "./passes/views.ts";
import { buildWorkflowFacts } from "./passes/workflows.ts";
import { buildWorkflowTableFacts } from "./passes/workflow-tables.ts";
import { buildProjectGraph, type GraphInput } from "./graph.ts";
import { buildGraphDiagnostics } from "./graph-diagnostics.ts";
import { createModuleGraph, type ModuleGraph } from "./module-graph.ts";
import type { PathAlias } from "./path-resolver.ts";
import type { Parser } from "./parser.ts";
import { computeRevision } from "./revision.ts";
import { diagnostic, error } from "./diagnostics.ts";
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
  // D-157 applies to jobs too: their `run` sees the system-scoped db client, tables and
  // views alike, and the relation index is the same one the route pass builds its cases on.
  const jobs = buildJobFacts(graph);
  const jobRelations = buildJobRelationFacts(graph, jobs.jobs, schema.tables, views.views);
  const workflows = buildWorkflowFacts(graph);
  // A workflow declares no tables: its surface is derived from the jobs its steps reference.
  const workflowTables = buildWorkflowTableFacts(workflows.workflows, jobs.jobs);
  const locales = readLocaleCatalogs(graph);
  const pages = buildPageFacts(graph, routes.routes, input.transport ?? DEFAULT_TRANSPORT);
  const screens = buildScreens(graph, pages.pages);
  // D-202: full-stack projects declare the allowlist in facilis.config.ts; static templates
  // (no config file) declare it as a prerender() plugin option in vite.config.ts.
  const viteDeclaration = config.facts.source === null ? readVitePrerenderDeclaration(graph) : null;
  const prerenderDeclaration: PrerenderDeclaration =
    config.facts.source !== null
      ? { ...config.facts.prerender, source: config.facts.source }
      : (viteDeclaration ?? NO_PRERENDER_DECLARATION);
  const prerender = buildPrerenderFacts(
    graph,
    prerenderDeclaration,
    routeRelations.routes,
    pages.pages,
  );
  const fileFacts = buildFileFacts(graph);
  // D-226: one surface computation feeds the build gate, the IDE and the release export.
  const surface = buildSecuritySurfaceFacts(graph, fileFacts, routes.routes);

  const diagnostics: Diagnostic[] = [];
  for (const file of graph.files.values()) {
    for (const error of file.errors) {
      diagnostics.push(diagnostic("parse-error", "error", error.message, error.source));
    }
  }
  diagnostics.push(
    ...[
      ...config.diagnostics,
      // D-224: the runtime/public declarations and their read sites agree (six codes).
      ...runtimeConfigDiagnostics(graph, config.facts),
      // D-224: a direct process.env read bypasses the declared surface (warn-only).
      ...noDirectEnvDiagnostics(graph),
      ...routes.diagnostics,
      ...schema.diagnostics,
      ...views.diagnostics,
      ...routeRelations.diagnostics,
      // D-215: a project route may not shadow a framework-owned path (invariant 6).
      ...reservedRoutePrefixDiagnostics(routes.routes),
      // D-217: one warning per import cycle over project-internal static edges (warn-only).
      ...importCycleDiagnostics(graph, fileFacts),
      // D-212: GET routes must be side-effect free (SPEC §8.6), over the same usage facts.
      ...routeGetEffectDiagnostics(routeRelations.routes),
      // D-214: literal raw SQL never writes a seed-only auth table (invariant 8).
      ...rawSqlSystemWriteDiagnostics([
        ...routeRelations.routes.map((route) => route.relations),
        ...Object.values(jobRelations.relations),
      ]),
      ...jobs.diagnostics,
      ...jobRelations.diagnostics,
      ...locales.diagnostics,
      // D-218: a non-literal t() key is visible but unverifiable (warn-only).
      ...dynamicTranslationKeyDiagnostics(fileFacts),
      ...pages.diagnostics,
      ...prerender.diagnostics,
      ...(viteDeclaration?.unknown ?? []).map((fact) => error(fact.code, fact.reason, fact.source)),
      ...routeSystemTableDiagnostics(routes.routes, schema.tables),
      ...workflows.diagnostics,
      ...workflowTables.diagnostics,
      ...surface.diagnostics,
    ].filter(
      // Framework sources are shipped code: their facts stay, but their lint-style
      // diagnostics are not the project's. Project files start outside node_modules/.
      (entry) => entry.source === null || !entry.source.file.startsWith("node_modules/"),
    ),
  );

  const graphInput: GraphInput = {
    routes: routes.routes,
    tables: schema.tables,
    relations: schema.relations,
    pages: pages.pages,
    views: views.views,
    screens,
    workflows: workflows.workflows,
  };
  const projectGraph = buildProjectGraph(graphInput);

  return {
    revision: computeRevision(input.files),
    files: [...graph.files.keys()].toSorted((left, right) => left.localeCompare(right)),
    config: config.facts,
    routes: routeRelations.routes,
    tables: schema.tables,
    enums: schema.enums,
    relations: schema.relations,
    views: views.views,
    pages: pages.pages,
    prerender: prerender.facts,
    workflows: workflows.workflows,
    jobs: jobs.jobs,
    jobRelations: jobRelations.relations,
    workflowTables: workflowTables.facts,
    fileFacts,
    locales: locales.locales,
    diagnostics,
    graph: projectGraph,
    // D-220 (#189): the IDE lenses read codes + params, never analyzer prose.
    graphDiagnostics: buildGraphDiagnostics({
      graph: projectGraph,
      routes: routes.routes,
      tables: schema.tables,
    }),
    surface: surface.surface,
  };
}
