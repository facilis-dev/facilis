/**
 * SEC-12 gate: a handwritten route must satisfy security invariants 1-2 — its default export
 * is the `@facilis.dev/core` `defineAuthorizedHandler` call, its config carries a statically
 * readable `dbTables` array, and (D-157) every relation it uses through `ctx.db` /
 * `ctx.sudo` / `ctx.system` is declared there. The AI validator already blocks patches that
 * miss this (packages/ai/src/rules/); handwritten code had no enforcement, so `pnpm test`
 * (and therefore CI) fails here.
 *
 * The gate runs the real analyzer instead of matching source text, so it agrees with the IDE
 * and the AI validator on what "valid" means. Framework sources are loaded (the default
 * `@facilis.dev` node_modules scope) so workspace package bindings resolve: a table imported from
 * `@facilis.dev/auth` is a known relation, and a helper call into a package is opaque (the
 * runtime guard is the authority), never a false error.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadProjectFiles } from "./fs.ts";
import { createModuleGraph } from "./module-graph.ts";
import { createOxcParser } from "./node.ts";
import { buildConfigFacts } from "./passes/config.ts";
import { buildRouteFacts } from "./passes/routes.ts";
import { buildRouteRelationFacts } from "./passes/route-relations.ts";
import { buildSchemaFacts } from "./passes/schema.ts";
import { buildViewFacts } from "./passes/views.ts";
import type { Parser } from "./parser.ts";
import type { Diagnostic } from "./types.ts";

/** Directories the analyzer lists as routes; keep in sync with passes/routes.ts. */
const ROUTE_DIRS = ["server/routes/", "server/api/"] as const;

/** D-157 error codes: the gate fails on any of these (the unused warning does not block). */
const RELATION_ERROR_CODES = new Set([
  "route-table-undeclared",
  "route-table-unresolved",
  "route-raw-sql",
  "route-elevation-undeclared",
]);

/** Walk up from this file so the gate does not depend on the process cwd. */
function repositoryRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot locate the repo root from " + import.meta.url);
    current = parent;
  }
}

const REPO_ROOT = repositoryRoot();

function hasServerRoutes(directory: string): boolean {
  return ROUTE_DIRS.some((routeDir) => existsSync(join(directory, routeDir)));
}

/** `examples/` holds one directory per app; `starter/` may be a template root itself. */
function appsWithRoutes(directory: string): string[] {
  if (!existsSync(directory)) return [];
  if (hasServerRoutes(directory)) return [directory];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name))
    .filter(hasServerRoutes);
}

function reasonFor(diagnostics: readonly Diagnostic[], code: string, file: string): string {
  return (
    diagnostics.find((item) => item.code === code && item.source?.file === file)?.message ?? ""
  );
}

interface AppScan {
  readonly routeFiles: number;
  readonly violations: readonly string[];
}

/** Run the analyzer over one app and report every route that breaks invariant 1 or 2. */
function scanApp(appRoot: string, label: string, parser: Parser): AppScan {
  const graph = createModuleGraph({ files: loadProjectFiles(appRoot), parser });
  const config = buildConfigFacts(graph).facts;
  const routeFacts = buildRouteFacts(graph, config);
  const schema = buildSchemaFacts(graph, config);
  const views = buildViewFacts(graph);
  const relations = buildRouteRelationFacts(graph, routeFacts.routes, schema.tables, views.views);
  const bySourceFile = new Map(routeFacts.routes.map((route) => [route.sourceFile, route]));
  const violations: string[] = [];
  let routeFiles = 0;
  for (const path of graph.files.keys()) {
    if (!ROUTE_DIRS.some((routeDir) => path.startsWith(routeDir))) continue;
    routeFiles += 1;
    const where = label + "/" + path;
    const route = bySourceFile.get(path);
    if (route === undefined) {
      violations.push(where + ": no route fact; the filename is not a Nitro route location");
      continue;
    }
    if (route.wrapper !== "valid") {
      const reason = reasonFor(routeFacts.diagnostics, "route-wrapper", path);
      violations.push(where + ': wrapper is "' + route.wrapper + '"; ' + reason);
      continue;
    }
    if (route.dbTables === null) {
      const reason =
        reasonFor(routeFacts.diagnostics, "db-tables-present", path) ||
        reasonFor(routeFacts.diagnostics, "route-config-static", path);
      violations.push(where + ": dbTables is not statically declared; " + reason);
    }
  }
  for (const diagnostic of relations.diagnostics) {
    if (!RELATION_ERROR_CODES.has(diagnostic.code)) continue;
    const file = diagnostic.source?.file ?? "unknown";
    violations.push(label + "/" + file + ": " + diagnostic.code + ": " + diagnostic.message);
  }
  return { routeFiles, violations };
}

function writeSource(root: string, path: string, source: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, source);
}

const CORE = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';
const FIXTURE_SCHEMA =
  'import { pgTable, uuid } from "drizzle-orm/pg-core";\n' +
  'export const todos = pgTable("todos", { id: uuid("id").primaryKey() });\n' +
  'export const notes = pgTable("notes", { id: uuid("id").primaryKey() });\n';

describe("SEC-12 route gate", () => {
  it("passes on every handwritten route shipped in examples/ and starter/", () => {
    const apps = ["examples", "starter"].flatMap((group) => appsWithRoutes(join(REPO_ROOT, group)));
    expect(apps.length, "no app with server routes under examples/ or starter/").toBeGreaterThan(0);
    const parser = createOxcParser();
    const scans = apps.map((app) => scanApp(app, relative(REPO_ROOT, app), parser));
    const routeFiles = scans.reduce((total, scan) => total + scan.routeFiles, 0);
    const violations = scans.flatMap((scan) => scan.violations);
    expect(routeFiles, "the gate found no route files").toBeGreaterThan(0);
    expect(
      violations,
      "handwritten routes violate invariants 1-2:\n" + violations.join("\n"),
    ).toEqual([]);
  });

  it("flags deliberately broken handwritten routes", () => {
    const fixture = mkdtempSync(join(tmpdir(), "facilis-route-gate-"));
    try {
      writeSource(fixture, "db/schema.ts", FIXTURE_SCHEMA);
      writeSource(
        fixture,
        "server/routes/hand-rolled.get.ts",
        "export default async () => null;\n",
      );
      writeSource(
        fixture,
        "server/routes/no-tables.get.ts",
        CORE + "export default defineAuthorizedHandler({ permission: [] }, async () => null);\n",
      );
      writeSource(
        fixture,
        "server/routes/dynamic-tables.get.ts",
        CORE +
          "export default defineAuthorizedHandler({ permission: [], dbTables: loadTables() }, async () => null);\n",
      );
      writeSource(
        fixture,
        "server/routes/undeclared.get.ts",
        CORE +
          'import { notes } from "~/db/schema";\n' +
          "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async (_event, { db }) => db.select().from(notes));\n",
      );
      writeSource(
        fixture,
        "server/routes/raw.get.ts",
        CORE +
          'export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async (_event, { db }) => db.execute("select 1"));\n',
      );
      writeSource(
        fixture,
        "server/routes/dynamic-relation.get.ts",
        CORE +
          "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async (_event, { db }) => db.select().from(loadTable()));\n" +
          "function loadTable(): unknown { return null; }\n",
      );
      writeSource(
        fixture,
        "server/routes/elevation.get.ts",
        CORE +
          'import { notes } from "~/db/schema";\n' +
          'export default defineAuthorizedHandler({ permission: [], dbTables: ["todos", "notes"] }, async (_event, { sudo }) => sudo({ operation: "x", reason: "y", tables: ["todos"] }, (systemDb) => systemDb.delete(notes)));\n',
      );
      writeSource(
        fixture,
        "server/routes/good.get.ts",
        CORE +
          'import { todos } from "~/db/schema";\n' +
          'export default defineAuthorizedHandler({ permission: [], dbTables: ["todos"] }, async (_event, { db }) => db.select().from(todos));\n',
      );
      const scan = scanApp(fixture, "fixture", createOxcParser());
      const report = scan.violations.join("\n");
      expect(scan.routeFiles).toBe(8);
      expect(report).toMatch(/hand-rolled\.get\.ts: wrapper is "invalid"/);
      expect(report).toContain(
        "no-tables.get.ts: dbTables is not statically declared; dbTables is missing",
      );
      expect(report).toContain("dynamic-tables.get.ts: dbTables is not statically declared");
      expect(report).toContain("undeclared.get.ts: route-table-undeclared");
      expect(report).toContain("raw.get.ts: route-raw-sql");
      expect(report).toContain("dynamic-relation.get.ts: route-table-unresolved");
      expect(report).toContain("elevation.get.ts: route-elevation-undeclared");
      expect(report).not.toContain("good.get.ts");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
