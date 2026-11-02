// The API Flow strings (SPEC §10.2, §12 Phase 3), spread into `en` in en.ts.
//
// The catalogue sits at the 300-line limit, so this feature block lives in its own module
// instead of growing en.ts — same rule as en-data-explorer.ts. Keys stay flat.
export const apiFlowEn = {
  "activity.apiFlow": "API Flow",

  "apiFlow.title": "API Flow",
  "apiFlow.refresh": "Refresh API graph",
  "apiFlow.retry": "Try again",
  "apiFlow.unreachable": "Project not reachable",
  "apiFlow.unreachableHint": "Run the project to read its /_openapi.json.",
  "apiFlow.loading": "Reading the OpenAPI document…",
  "apiFlow.error": "Could not read the API graph: {error}",
  "apiFlow.empty": "No routes in the OpenAPI document.",
  "apiFlow.emptyHint": "Add a route under server/routes — it shows up here.",
  "apiFlow.openapiDisabled":
    "OpenAPI is disabled for this project. Turn on experimental.openAPI in nitro.config.ts.",

  "apiFlow.warnings": "{count} warning(s) reported",
  "apiFlow.stats": "{routes} route(s) · {tables} table(s) · {edges} edge(s)",
  "apiFlow.legend": "Legend",
  "apiFlow.legendRoute": "route",
  "apiFlow.legendTable": "table",
  "apiFlow.legendColumnEdge": "dashed: column-level only",
  "apiFlow.methodCount": "{method} {count}",

  "apiFlow.routeTables": "{count} table(s)",
  "apiFlow.tableColumns": "{count} column(s)",
  "apiFlow.tableRoutes": "{count} route(s)",
  "apiFlow.permission": "Requires {permission}",
  "apiFlow.openRoute": "Open {route}",
  "apiFlow.openTable": "Open db/schema.ts",
} as const;
