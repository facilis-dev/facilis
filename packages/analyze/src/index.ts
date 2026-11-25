/**
 * @facilis.dev/analyze — static facts for the Facilis project DSL.
 *
 * Zero build-time execution: the caller supplies a file map and an injected parser; the
 * analyzer interprets the declared DSL (routes, config, Drizzle schema, relations, pages).
 * The Node parser adapter lives on the `@facilis.dev/analyze/node` subpath so the main entry
 * stays browser-safe.
 */
export { analyzeProject, DEFAULT_TRANSPORT } from "./analyze.ts";
export type { AnalyzeInput } from "./analyze.ts";
export { buildProjectGraph } from "./graph.ts";
export type { GraphInput } from "./graph.ts";
export { ROUTE_DESCRIPTION_MAX_CHARS } from "./passes/route-description.ts";
// The fail-closed prerender eligibility contract (D-202), shared with both build gates.
export { formatPrerenderReasons, prerenderBuildErrors } from "./passes/prerender.ts";
// The stable route id shared by facts, the graph and the prerender data join (D-202).
export { routeFactId } from "./passes/route-location.ts";
// The fixed service -> table surface (D-199), shared with AI validator rule 18.
export { SERVICE_TABLES } from "./passes/route-services.ts";
// The GET side-effect contract (D-212), shared with AI validator rule 21.
export {
  FRAMEWORK_GET_READ_EXEMPTIONS,
  FRAMEWORK_GET_WRITE_EXEMPTIONS,
  isGetLikeMethod,
  routeGetSideEffects,
  type GetSideEffects,
} from "./passes/route-get-effects.ts";
// The table access-class contract (D-211), shared with AI validator rule 20.
export { tableClassOf, type TableClass } from "./passes/schema-class.ts";
// The raw-client module list (invariant 5, D-213), shared with AI rule 9 and the route gate.
export { isRawDbImport } from "./raw-db-imports.ts";
export { createModuleGraph } from "./module-graph.ts";
export type { Binding, ModuleGraph, ProjectFile } from "./module-graph.ts";
export { createPathResolver, normalizePath } from "./path-resolver.ts";
export type { PathAlias } from "./path-resolver.ts";
export type { Parser, ParseError, ParsedModule, SourceComment } from "./parser.ts";
export { diagnostic, error, info, warning } from "./diagnostics.ts";
export { computeRevision } from "./revision.ts";
// The plan-shaped view of the schema facts (the Release Preview's planSchema input, #47).
export { schemaSnapshotFromAnalysis } from "./schema-snapshot.ts";
// The one id spelling shared by graph nodes and edges (D-092), for UI joins by node id.
export { pageId, routeId, tableId, viewId, workflowId } from "./graph-ids.ts";
export type { TransportSpec } from "./passes/clients.ts";
// Job facts live in types-jobs.ts (the 300-line split of types.ts), so export them here.
export type { JobFact, JobRelationsFact } from "./types-jobs.ts";
export type * from "./types.ts";
