/**
 * @facilis/analyze — static facts for the Facilis project DSL.
 *
 * Zero build-time execution: the caller supplies a file map and an injected parser; the
 * analyzer interprets the declared DSL (routes, config, Drizzle schema, relations, pages).
 * The Node parser adapter lives on the `@facilis/analyze/node` subpath so the main entry
 * stays browser-safe.
 */
export { analyzeProject, DEFAULT_TRANSPORT } from "./analyze.ts";
export type { AnalyzeInput } from "./analyze.ts";
export { buildProjectGraph } from "./graph.ts";
export type { GraphInput } from "./graph.ts";
export { ROUTE_DESCRIPTION_MAX_CHARS } from "./passes/route-description.ts";
export { createModuleGraph } from "./module-graph.ts";
export type { Binding, ModuleGraph, ProjectFile } from "./module-graph.ts";
export { createPathResolver, normalizePath } from "./path-resolver.ts";
export type { PathAlias } from "./path-resolver.ts";
export type { Parser, ParseError, ParsedModule } from "./parser.ts";
export { diagnostic, error, info, warning } from "./diagnostics.ts";
export { computeRevision } from "./revision.ts";
export type { TransportSpec } from "./passes/clients.ts";
// Job facts live in types-jobs.ts (the 300-line split of types.ts), so export them here.
export type { JobFact, JobRelationsFact } from "./types-jobs.ts";
export type * from "./types.ts";
