import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { Analysis, Diagnostic, RouteFact } from "@facilis/analyze";
import type { ManifestWarning } from "@facilis/core";

import {
  analyzeProjectRoutes,
  routeMetadataFromAnalysis,
  scanRouteMetadata,
} from "./route-metadata.ts";

const projectRoot = fileURLToPath(new URL("../test-fixtures/project", import.meta.url));
const absentRoot = fileURLToPath(new URL("../test-fixtures/absent", import.meta.url));
const invalidConfigRoot = fileURLToPath(
  new URL("../test-fixtures/invalid-config", import.meta.url),
);

function collectWarnings() {
  const warnings: ManifestWarning[] = [];
  return { warnings, onWarning: (warning: ManifestWarning) => warnings.push(warning) };
}

function routeFact(
  overrides: Partial<RouteFact> & Pick<RouteFact, "method" | "path" | "sourceFile">,
): RouteFact {
  const base: RouteFact = {
    method: overrides.method,
    path: overrides.path,
    sourceFile: overrides.sourceFile,
    source: { file: overrides.sourceFile, line: 1 },
    wrapper: "valid",
    permission: [],
    dbTables: [],
    dbColumns: [],
    description: null,
    input: { body: false, form: false, query: false, params: false },
    handlerBodyRead: false,
    handlerFormRead: false,
    elevations: [],
    unknown: [],
  };
  return { ...base, ...overrides };
}

function diagnostic(code: string, file: string | null): Diagnostic {
  return {
    code,
    severity: "error",
    message: code,
    source: file === null ? null : { file, line: 1 },
  };
}

/** A hand-built analysis so adapter-only rules are testable without extra fixtures. */
function emptyAnalysis(overrides: Partial<Analysis> = {}): Analysis {
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
    pages: [],
    workflows: [],
    fileFacts: [],
    locales: {},
    diagnostics: [],
    graph: { nodes: [], edges: [] },
    ...overrides,
  };
}

describe("scanRouteMetadata", () => {
  it("extracts wrapped defineAuthorizedHandler configs", () => {
    const metadata = scanRouteMetadata({ rootDir: projectRoot });

    expect(metadata["/health"]?.["get"]).toMatchObject({
      method: "GET",
      permission: [],
      dbTables: [],
      dbColumns: [],
      description: "Health probe.",
      unresolved: [],
      sourceFile: "server/routes/health.get.ts",
    });
    expect(metadata["/api/todos"]?.["get"]).toMatchObject({
      method: "GET",
      permission: ["todos:read"],
      dbTables: ["todos"],
      dbColumns: ["todos.title", "todos.done", "todos.ownerId"],
      description: "List todos.",
      unresolved: [],
      sourceFile: "server/routes/api/todos/index.get.ts",
    });
    expect(metadata["/api/todos"]?.post).toMatchObject({
      method: "POST",
      // The analyzer normalizes a single permission to a one-element array.
      permission: ["todos:write"],
      dbTables: ["todos"],
      dbColumns: ["todos.title", "todos.ownerId"],
      sourceFile: "server/routes/api/todos/index.post.ts",
    });
    expect(metadata["/api/todos/{id}"]?.patch).toMatchObject({
      method: "PATCH",
      permission: ["todos:write", "todos:read"],
      dbTables: ["todos"],
      dbColumns: ["todos.title"],
      sourceFile: "server/routes/api/todos/[id].patch.ts",
    });
  });

  it("reads a same-file const dbTables value instead of reporting it unresolved", () => {
    const analysis = analyzeProjectRoutes(projectRoot);
    const dynamic = analysis?.routes.find((fact) => fact.path === "/dynamic");

    // The old pass could not follow the const; the analyzer's static subset can, including
    // through the `as const` in the fixture (TS-ESTree from rolldown's parser).
    expect(dynamic).toMatchObject({
      wrapper: "valid",
      dbTables: ["todos"],
      dbColumns: [],
    });
    expect(dynamic?.unknown).toEqual([]);

    const metadata = scanRouteMetadata({ rootDir: projectRoot });
    expect(metadata["/dynamic"]?.get).toMatchObject({
      dbTables: ["todos"],
      dbColumns: [],
      unresolved: [],
      warnings: [],
      description: "Same-file const table list, read statically by the analyzer.",
    });
  });

  it("lists unwrapped route files as invalid routes instead of skipping them", () => {
    const analysis = analyzeProjectRoutes(projectRoot);
    const warnings = collectWarnings();
    const metadata = scanRouteMetadata({ rootDir: projectRoot, ...warnings });

    // Integrity view: the analyzer reports every route file, including /plain and /manual
    // (the latter used to be read through the defineRouteMeta fallback, which the analyzer
    // deliberately does not implement - the wrapper is the DSL).
    expect(
      analysis?.routes.filter((fact) => fact.sourceFile === "server/routes/plain.get.ts"),
    ).toMatchObject([{ path: "/plain", wrapper: "invalid" }]);
    expect(
      analysis?.routes.filter((fact) => fact.sourceFile === "server/routes/manual.get.ts"),
    ).toMatchObject([{ path: "/manual", wrapper: "invalid" }]);

    for (const path of ["/plain", "/manual"]) {
      expect(metadata[path]?.["get"]).toMatchObject({
        method: "GET",
        dbTables: [],
        dbColumns: [],
        unresolved: ["permission", "dbTables", "dbColumns"],
      });
      expect(metadata[path]?.["get"]?.permission).toBeUndefined();
      expect(metadata[path]?.["get"]?.description).toBeUndefined();
      const routeWarnings = metadata[path]?.["get"]?.warnings ?? [];
      expect(routeWarnings).toHaveLength(1);
      expect(routeWarnings[0]).toMatchObject({
        code: "route-wrapper",
        section: "routes",
        sourceFile: `server/routes/${path.slice(1)}.get.ts`,
      });
    }
    // Route-level diagnostics are attached to their route, not duplicated on the sink.
    expect(warnings.warnings).toEqual([]);
  });

  it("keeps null facts unresolved instead of guessing values", () => {
    const metadata = routeMetadataFromAnalysis(
      emptyAnalysis({
        routes: [
          routeFact({
            method: "GET",
            path: "/unknown",
            sourceFile: "server/routes/api/unknown.get.ts",
            permission: null,
            dbTables: null,
            dbColumns: null,
            description: null,
          }),
        ],
      }),
    );

    expect(metadata["/unknown"]?.["get"]).toMatchObject({
      dbTables: [],
      dbColumns: [],
      unresolved: ["permission", "dbTables", "dbColumns"],
    });
    expect(metadata["/unknown"]?.["get"]?.permission).toBeUndefined();
  });

  it("reports parse/config diagnostics that belong to no route through onWarning", () => {
    const warnings = collectWarnings();
    const metadata = scanRouteMetadata({ rootDir: invalidConfigRoot, ...warnings });

    expect(metadata).toEqual({});
    expect(warnings.warnings).toHaveLength(1);
    expect(warnings.warnings[0]).toMatchObject({
      code: "config-static",
      section: "routes",
      sourceFile: "facilis.config.ts",
    });
  });

  it("ignores framework diagnostics from node_modules", () => {
    const warnings = collectWarnings();
    const metadata = routeMetadataFromAnalysis(
      emptyAnalysis({
        diagnostics: [
          diagnostic("parse-error", "node_modules/@facilis/core/src/broken.ts"),
          diagnostic("config-static", "node_modules/@facilis/core/src/config.ts"),
        ],
      }),
      warnings.onWarning,
    );

    expect(metadata).toEqual({});
    expect(warnings.warnings).toEqual([]);
  });

  it("omits methods outside the manifest contract and warns instead of dropping them silently", () => {
    const warnings = collectWarnings();
    const metadata = routeMetadataFromAnalysis(
      emptyAnalysis({
        routes: [
          routeFact({
            method: "HEAD",
            path: "/cache",
            sourceFile: "server/routes/cache.head.ts",
            permission: ["todos:read"],
          }),
        ],
      }),
      warnings.onWarning,
    );

    expect(metadata).toEqual({});
    expect(warnings.warnings).toHaveLength(1);
    expect(warnings.warnings[0]).toMatchObject({
      code: "route-method-unsupported",
      section: "routes",
      sourceFile: "server/routes/cache.head.ts",
    });
  });

  it("returns an empty map for a project root that does not exist", () => {
    const warnings = collectWarnings();
    const metadata = scanRouteMetadata({ rootDir: absentRoot, ...warnings });

    expect(metadata).toEqual({});
    expect(warnings.warnings).toEqual([]);
  });

  it("is deterministic across runs", () => {
    const first = scanRouteMetadata({ rootDir: projectRoot });
    const second = scanRouteMetadata({ rootDir: projectRoot });

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
