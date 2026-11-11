import type { Analysis, RouteFact } from "@facilis.dev/analyze";

/** Shared fixtures for the route-metadata adapter suites (kept out of the 300-line budget). */
export function routeFact(
  overrides: Partial<RouteFact> & Pick<RouteFact, "method" | "path" | "sourceFile">,
): RouteFact {
  const base: RouteFact = {
    method: overrides.method,
    path: overrides.path,
    sourceFile: overrides.sourceFile,
    source: { file: overrides.sourceFile, line: 1 },
    wrapper: "valid",
    permission: [],
    crossSite: false,
    rawSql: false,
    dbTables: [],
    dbColumns: [],
    relations: { used: [], unresolved: [], rawSql: [], opaque: false, elevations: [] },
    description: null,
    input: { body: false, form: false, query: false, params: false },
    handlerBodyRead: false,
    handlerFormRead: false,
    elevations: [],
    unknown: [],
  };
  return { ...base, ...overrides };
}

/** A hand-built analysis so adapter-only rules are testable without extra fixtures. */
export function emptyAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    revision: "",
    files: [],
    config: {
      parsed: false,
      source: null,
      permissions: [],
      roles: {},
      defaultRole: null,
      defaultLocale: "en",
      locales: ["en"],
      migrationsDir: "./drizzle",
      tenantColumns: ["tenantId"],
      ownerColumns: ["ownerId"],
      unknown: [],
    },
    routes: [],
    tables: [],
    relations: [],
    views: [],
    pages: [],
    workflows: [],
    jobs: [],
    jobRelations: {},
    workflowTables: [],
    fileFacts: [],
    locales: {},
    diagnostics: [],
    graph: { nodes: [], edges: [] },
    ...overrides,
  };
}
