import type { FrameworkModule } from "../framework-reference";

/**
 * `@facilis.dev/analyze` — static facts for the project DSL (D-092).
 *
 * Zero build-time execution: the caller supplies a file map and an injected parser; the
 * analyzer interprets the declared DSL (routes, config, Drizzle schema, relations, pages,
 * workflows) into the fact model and, from it, the project graph.
 */
export const ANALYZE_MODULE: FrameworkModule = {
  id: "analyze",
  package: "@facilis.dev/analyze",
  summary:
    "AST analyzer: analyzeProject facts (config, routes, tables, views, jobs, workflows, pages), the project graph, module graph and diagnostics.",
  entries: [
    {
      name: "analyzeProject",
      kind: "function",
      signature: "analyzeProject(input: AnalyzeInput): Analysis",
      summary:
        "Analyzes one project snapshot into the fact model + project graph. Pure and synchronous; the Node parser adapter lives on @facilis.dev/analyze/node.",
      example:
        "const analysis = analyzeProject({ files, parser: createNodeParser() });\nanalysis.routes, analysis.tables, analysis.graph",
    },
    {
      name: "AnalyzeInput",
      kind: "type",
      signature:
        "interface AnalyzeInput { files: ReadonlyMap<string, string>; parser: Parser; rootDir?: string; aliases?: readonly PathAlias[]; transport?: TransportSpec }",
      summary:
        "The analyzer input: a project-relative path → source map (the analyzer never touches the filesystem), the injected parser, an optional root and tsconfig aliases.",
    },
    {
      name: "Analysis",
      kind: "type",
      signature:
        "interface Analysis { revision: string; files: readonly string[]; config: ConfigFacts; routes: readonly RouteFact[]; tables: readonly TableFact[]; relations: readonly RelationFact[]; views: readonly ViewFact[]; pages: readonly PageFact[]; workflows: readonly WorkflowFact[]; jobs: readonly JobFact[]; jobRelations; workflowTables; fileFacts; locales; diagnostics; graph: ProjectGraph }",
      summary:
        "The whole fact model; a fact that cannot be determined is null or an unknown entry, never an empty value ('dbTables unknown' is not 'no tables').",
    },
    {
      name: "buildProjectGraph",
      kind: "function",
      signature: "buildProjectGraph(input: GraphInput): ProjectGraph",
      summary:
        "Builds the stable project graph (nodes and edges, sorted by id) from route/table/relation/page/view/workflow facts; ids match the graph-ids spelling.",
    },
    {
      name: "RouteFact",
      kind: "type",
      signature:
        "interface RouteFact { method: HttpMethod; path: string; sourceFile: string; source: SourceRef; wrapper: WrapperState; permission: readonly string[] | null; crossSite: boolean | null; dbTables: readonly string[] | null; dbColumns: readonly string[] | null; rawSql: boolean | null; relations: RouteRelationsFact; description: string | null; input: RouteInputFact; handlerBodyRead: boolean }",
      summary:
        "One route read from server/routes/**: the wrapper state, declared permission/crossSite/dbTables/description and the static db usage of the handler body.",
    },
    {
      name: "TableFact",
      kind: "type",
      signature:
        "interface TableFact { name: string; binding: string | null; columns: readonly ColumnFact[]; primaryKey: readonly string[]; foreignKeys: readonly ForeignKeyFact[]; policies: readonly PolicyFact[]; rlsEnabled: boolean; scope: ScopeFact | null; source: SourceRef; unknown: readonly UnknownFact[] }",
      summary:
        "One Drizzle table: columns, keys, policies, whether RLS is enabled and which scope column (tenant/owner) it carries.",
    },
    {
      name: "JobFact",
      kind: "type",
      signature:
        "interface JobFact { name: string; sourceFile: string; source: SourceRef; dbTables: readonly string[] | null; rawSql: boolean | null; unknown: readonly UnknownFact[] }",
      summary:
        "One server/jobs/** defineJob default export: declared name, dbTables (null when unreadable, fail closed) and rawSql; its run's usage lives in analysis.jobRelations.",
    },
    {
      name: "WorkflowFact",
      kind: "type",
      signature:
        "interface WorkflowFact { name: string; sourceFile: string; source: SourceRef; steps: readonly WorkflowStepFact[]; unknown: readonly UnknownFact[] }",
      summary:
        "One server/workflows/** defineWorkflow default export: ordered job/approval steps with assignment permission and forward onReject target.",
    },
    {
      name: "createModuleGraph",
      kind: "function",
      signature: "createModuleGraph(input: ModuleGraphInput): ModuleGraph",
      summary:
        "Parses every source file once and resolves imports/bindings/exports/JSON across the project; the analyzer builds its facts on top of it.",
    },
    {
      name: "computeRevision",
      kind: "function",
      signature: "computeRevision(files: ReadonlyMap<string, string>): string",
      summary:
        "Deterministic, browser-safe FNV revision of the analyzed file set; cache invalidation and the manifest reuse it.",
    },
  ],
};
