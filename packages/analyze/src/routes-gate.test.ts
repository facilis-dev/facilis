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
import { buildJobFacts } from "./passes/jobs.ts";
import { buildJobRelationFacts } from "./passes/job-relations.ts";
import { routeGetEffectDiagnostics } from "./passes/route-get-effects.ts";
import { reservedRoutePrefixDiagnostics } from "./passes/route-reserved-prefix.ts";
import { rawSqlSystemWriteDiagnostics } from "./passes/raw-sql-system-write.ts";
import { buildSchemaFacts } from "./passes/schema.ts";
import { buildViewFacts } from "./passes/views.ts";
import type { Parser } from "./parser.ts";
import { isRawDbImport } from "./raw-db-imports.ts";
import { isReservedRouteFile } from "./reserved-route-paths.ts";
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
  /** Declared-but-unused warnings: the shipped apps must boot with zero (D-199). */
  readonly unused: readonly string[];
  /** GET side-effect warnings (opaque bodies): visible, but never a guessed error (D-212). */
  readonly getWarnings: readonly string[];
}

/** Run the analyzer over one app and report every route that breaks invariant 1 or 2. */
function scanApp(appRoot: string, label: string, parser: Parser): AppScan {
  const graph = createModuleGraph({ files: loadProjectFiles(appRoot), parser });
  const config = buildConfigFacts(graph).facts;
  const routeFacts = buildRouteFacts(graph, config);
  const schema = buildSchemaFacts(graph, config);
  const views = buildViewFacts(graph);
  const relations = buildRouteRelationFacts(graph, routeFacts.routes, schema.tables, views.views);
  const jobRelations = buildJobRelationFacts(graph, buildJobFacts(graph).jobs, schema.tables, views.views);
  const bySourceFile = new Map(routeFacts.routes.map((route) => [route.sourceFile, route]));
  const violations: string[] = [];
  const unused: string[] = [];
  const getWarnings: string[] = [];
  let routeFiles = 0;
  // D-215: the framework owns the route directory itself (invariant 6), so the file
  // location fails before the route fact is even considered.
  for (const [path, file] of graph.files) {
    if (!ROUTE_DIRS.some((routeDir) => path.startsWith(routeDir))) continue;
    routeFiles += 1;
    const where = label + "/" + path;
    if (isReservedRouteFile(path)) {
      violations.push(
        where +
          ": reserved-route-prefix: the route file lives under a framework-owned route directory",
      );
      continue;
    }
    // Invariant 5 parity with AI rule 9: a handwritten route may not build a raw client.
    for (const imported of file.module.imports) {
      if (!isRawDbImport(imported.specifier)) continue;
      violations.push(
        where +
          ': no-raw-db-access: importing "' +
          imported.specifier +
          '" is a raw database client outside @facilis.dev/db',
      );
    }
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
    // Invariant 3 parity with AI rule 8; a body-less GET legitimately declares no schema.
    if (route.handlerBodyRead && !route.input.body) {
      violations.push(
        where +
          ": route-input-validated: the handler reads the request body but the route declares no body schema",
      );
    }
    if (route.handlerFormRead && !route.input.form) {
      violations.push(
        where +
          ": route-input-validated: the handler reads the multipart form but the route declares no form schema",
      );
    }
  }
  for (const diagnostic of relations.diagnostics) {
    const file = diagnostic.source?.file ?? "unknown";
    if (diagnostic.code === "route-table-unused") {
      unused.push(label + "/" + file + ": " + diagnostic.message);
      continue;
    }
    if (!RELATION_ERROR_CODES.has(diagnostic.code)) continue;
    violations.push(label + "/" + file + ": " + diagnostic.code + ": " + diagnostic.message);
  }
  // D-215: a project route may not shadow a framework-owned path (invariant 6).
  for (const diagnostic of reservedRoutePrefixDiagnostics(routeFacts.routes)) {
    const file = diagnostic.source?.file ?? "unknown";
    // A file under the framework route directory already failed the location check above.
    if (isReservedRouteFile(file)) continue;
    violations.push(label + "/" + file + ": " + diagnostic.code + ": " + diagnostic.message);
  }
  // D-214: a literal raw-SQL write to a seed-only auth table is a violation (invariant 8).
  for (const diagnostic of rawSqlSystemWriteDiagnostics([
    ...relations.routes.map((route) => route.relations),
    ...Object.values(jobRelations.relations),
  ])) {
    const file = diagnostic.source?.file ?? "unknown";
    violations.push(label + "/" + file + ": " + diagnostic.code + ": " + diagnostic.message);
  }
  // D-212: a proven write in a GET is a violation; an opaque body only warns.
  for (const diagnostic of routeGetEffectDiagnostics(relations.routes)) {
    const file = diagnostic.source?.file ?? "unknown";
    const where = label + "/" + file + ": " + diagnostic.code + ": " + diagnostic.message;
    if (diagnostic.severity === "error") violations.push(where);
    else getWarnings.push(where);
  }
  return { routeFiles, violations, unused, getWarnings };
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

  it("ships no declared-but-unused table in examples/ and starter/ (D-199)", () => {
    const apps = ["examples", "starter"].flatMap((group) => appsWithRoutes(join(REPO_ROOT, group)));
    expect(apps.length, "no app with server routes under examples/ or starter/").toBeGreaterThan(0);
    const parser = createOxcParser();
    const unused = apps.flatMap((app) => scanApp(app, relative(REPO_ROOT, app), parser).unused);
    expect(unused, "route-table-unused warnings:\n" + unused.join("\n")).toEqual([]);
  });

  it("ships no GET side-effect warning in examples/ and starter/ (D-212, ide:smoke contract)", () => {
    const apps = ["examples", "starter"].flatMap((group) => appsWithRoutes(join(REPO_ROOT, group)));
    expect(apps.length, "no app with server routes under examples/ or starter/").toBeGreaterThan(0);
    const parser = createOxcParser();
    const perApp = apps.map((app) => {
      const scan = scanApp(app, relative(REPO_ROOT, app), parser);
      return { app: relative(REPO_ROOT, app), warnings: scan.getWarnings };
    });
    const report = perApp.map((entry) => entry.app + ": " + entry.warnings.length).join("\n");
    const all = perApp.flatMap((entry) => entry.warnings);
    expect(all, "GET side-effect warnings per app:\n" + report + "\n" + all.join("\n")).toEqual([]);
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

  it("flags state-changing GET routes and exempts the SSO pair (D-212)", () => {
    const fixture = mkdtempSync(join(tmpdir(), "facilis-get-gate-"));
    try {
      writeSource(fixture, "db/schema.ts", FIXTURE_SCHEMA);
      writeSource(
        fixture,
        "server/routes/get-insert.get.ts",
        CORE +
          'import { todos } from "~/db/schema";\n' +
          'export default defineAuthorizedHandler({ permission: [], dbTables: ["todos"] }, async (_event, { db }) => db.insert(todos).values({}));\n',
      );
      writeSource(
        fixture,
        "server/routes/get-helper.get.ts",
        CORE +
          'import { notes } from "~/db/schema";\n' +
          'export default defineAuthorizedHandler({ permission: [], dbTables: ["notes"] }, async (_event, { db }) => wipe(db));\n' +
          "function wipe(client: { delete: (relation: unknown) => unknown }) { return client.delete(notes); }\n",
      );
      writeSource(
        fixture,
        "server/routes/get-enqueue.get.ts",
        CORE +
          'export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async (_event, { jobs }) => jobs.enqueue("sync", {}));\n',
      );
      writeSource(
        fixture,
        "server/routes/get-read.get.ts",
        CORE +
          'import { todos } from "~/db/schema";\n' +
          'export default defineAuthorizedHandler({ permission: [], dbTables: ["todos"] }, async (_event, { db }) => db.select().from(todos));\n',
      );
      const ssoWrite =
        CORE +
        'import { notes } from "~/db/schema";\n' +
        'export default defineAuthorizedHandler({ permission: [], dbTables: ["notes"] }, async (_event, { system }) => system({ actor: "system:auth", operation: "auth:sso", reason: "y", tables: ["notes"] }, (systemDb) => systemDb.insert(notes).values({})));\n';
      writeSource(fixture, "server/routes/api/auth/sso/[provider]/start.get.ts", ssoWrite);
      writeSource(fixture, "server/routes/api/auth/sso/[provider]/callback.get.ts", ssoWrite);
      writeSource(
        fixture,
        "server/routes/get-opaque.get.ts",
        CORE +
          'import { ownerIsolationPolicy } from "@facilis.dev/db";\n' +
          "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async (_event, { db }) => ownerIsolationPolicy(db));\n",
      );
      const scan = scanApp(fixture, "fixture", createOxcParser());
      const report = scan.violations.join("\n");
      expect(scan.routeFiles).toBe(7);
      expect(report).toContain("get-insert.get.ts: route-get-side-effect");
      expect(report).toContain("get-helper.get.ts: route-get-side-effect");
      expect(report).toContain("get-enqueue.get.ts: route-get-side-effect");
      expect(report).not.toContain("get-read.get.ts");
      // D-215 makes an app route under /api/auth/sso an error; D-212 still exempts the pair
      // from the GET side-effect rule, so the only SSO findings are reserved-route-prefix.
      const ssoFindings = scan.violations.filter((entry) => entry.includes("api/auth/sso"));
      expect(ssoFindings.length).toBeGreaterThan(0);
      expect(ssoFindings.every((entry) => entry.includes("reserved-route-prefix"))).toBe(true);
      expect(report).not.toContain("get-opaque.get.ts");
      // The opaque body is a warning, never a guessed error.
      expect(scan.getWarnings.join("\n")).toContain("get-opaque.get.ts: route-get-side-effect");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("flags body reads without a schema and raw-client imports (D-213)", () => {
    const fixture = mkdtempSync(join(tmpdir(), "facilis-input-gate-"));
    try {
      writeSource(fixture, "db/schema.ts", FIXTURE_SCHEMA);
      writeSource(
        fixture,
        "server/routes/no-schema.post.ts",
        CORE +
          "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async (event) => event.body);\n",
      );
      writeSource(
        fixture,
        "server/routes/no-form.post.ts",
        CORE +
          "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async (event) => event.form);\n",
      );
      writeSource(
        fixture,
        "server/routes/schema.post.ts",
        CORE +
          'import { z } from "zod";\n' +
          "export default defineAuthorizedHandler({ permission: [], dbTables: [], body: z.object({ title: z.string() }) }, async (_event, { body }) => body);\n",
      );
      writeSource(
        fixture,
        "server/routes/read.get.ts",
        CORE +
          "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);\n",
      );
      writeSource(
        fixture,
        "server/routes/raw-client.get.ts",
        CORE +
          'import { drizzle } from "drizzle-orm/pglite";\n' +
          "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => drizzle);\n",
      );
      writeSource(
        fixture,
        "server/routes/schema-dsl.get.ts",
        CORE +
          'import { sql } from "drizzle-orm";\n' +
          'import { pgTable } from "drizzle-orm/pg-core";\n' +
          "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => (sql, pgTable));\n",
      );
      const scan = scanApp(fixture, "fixture", createOxcParser());
      const report = scan.violations.join("\n");
      expect(scan.routeFiles).toBe(6);
      expect(report).toContain("no-schema.post.ts: route-input-validated");
      expect(report).toContain("no-form.post.ts: route-input-validated");
      expect(report).toContain("raw-client.get.ts: no-raw-db-access");
      expect(report).not.toContain("/schema.post.ts:");
      expect(report).not.toContain("/read.get.ts:");
      expect(report).not.toContain("/schema-dsl.get.ts:");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("flags literal raw-SQL writes to seed-only auth tables (D-214)", () => {
    const fixture = mkdtempSync(join(tmpdir(), "facilis-raw-sql-gate-"));
    const rawRoute = (body: string): string =>
      CORE +
      "export default defineAuthorizedHandler({ permission: [], dbTables: [], rawSql: true }, " +
      body +
      ");\n";
    try {
      writeSource(fixture, "db/schema.ts", FIXTURE_SCHEMA);
      writeSource(
        fixture,
        "server/routes/insert-role-permissions.post.ts",
        rawRoute('async (_event, { db }) => db.execute("INSERT INTO role_permissions (role, permission) VALUES (\'user\', \'todos:read\')")'),
      );
      writeSource(
        fixture,
        "server/routes/sudo-delete-sessions.post.ts",
        rawRoute(
          'async (_event, { sudo }) => sudo({ operation: "x", reason: "y", tables: [] }, (db) => db.execute("DELETE FROM sessions"))',
        ),
      );
      writeSource(
        fixture,
        "server/routes/select-roles.post.ts",
        rawRoute(
          'async (_event, { sudo }) => sudo({ operation: "x", reason: "y", tables: [] }, (db) => db.execute("SELECT * FROM roles"))',
        ),
      );
      writeSource(
        fixture,
        "server/routes/dynamic-role.post.ts",
        rawRoute("async (_event, { db }) => db.execute(statement)"),
      );
      writeSource(
        fixture,
        "server/routes/ordinary-insert.post.ts",
        rawRoute('async (_event, { db }) => db.execute("INSERT INTO todos (id) VALUES (1)")'),
      );
      writeSource(
        fixture,
        "server/jobs/purge-sessions.ts",
        'import { defineJob } from "@facilis.dev/core";\n' +
          'export default defineJob({ name: "purge-sessions", dbTables: [], rawSql: true, async run({ db }) { await db.execute("DELETE FROM sessions"); } });\n',
      );
      const scan = scanApp(fixture, "fixture", createOxcParser());
      const report = scan.violations.join("\n");
      expect(scan.routeFiles).toBe(5);
      expect(report).toContain("insert-role-permissions.post.ts: raw-sql-system-write");
      expect(report).toContain("sudo-delete-sessions.post.ts: raw-sql-system-write");
      expect(report).toContain("server/jobs/purge-sessions.ts: raw-sql-system-write");
      expect(report).not.toContain("select-roles.post.ts");
      expect(report).not.toContain("dynamic-role.post.ts");
      expect(report).not.toContain("ordinary-insert.post.ts");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("flags project routes under a framework-owned path (D-215)", () => {
    const fixture = mkdtempSync(join(tmpdir(), "facilis-reserved-route-gate-"));
    const readRoute = (): string =>
      CORE +
      "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => null);\n";
    try {
      writeSource(fixture, "server/routes/__facilis/x.get.ts", readRoute());
      writeSource(fixture, "server/routes/_openapi.json.get.ts", readRoute());
      writeSource(fixture, "server/routes/api/auth/token.post.ts", readRoute());
      writeSource(fixture, "server/routes/api/auth/sso/callback.get.ts", readRoute());
      writeSource(fixture, "server/routes/api/auth/login.post.ts", readRoute());
      writeSource(fixture, "server/routes/api/files/[id].get.ts", readRoute());
      writeSource(fixture, "server/routes/api/jobs/index.post.ts", readRoute());
      writeSource(fixture, "server/routes/health.get.ts", readRoute());
      writeSource(fixture, "server/routes/__facilisx.get.ts", readRoute());
      writeSource(fixture, "server/routes/_openapi.get.ts", readRoute());
      // Framework route layout: packages/nitro's own route files are not project routes.
      writeSource(
        fixture,
        "packages/nitro/src/routes/manifest.get.ts",
        "export default () => null;\n",
      );
      const scan = scanApp(fixture, "fixture", createOxcParser());
      const report = scan.violations.join("\n");
      expect(scan.routeFiles).toBe(10);
      expect(report).toContain("__facilis/x.get.ts: reserved-route-prefix");
      expect(report).toContain("_openapi.json.get.ts: reserved-route-prefix");
      expect(report).toContain("api/auth/token.post.ts: reserved-route-prefix");
      expect(report).toContain("api/auth/sso/callback.get.ts: reserved-route-prefix");
      expect(report).not.toContain("api/auth/login.post.ts");
      expect(report).not.toContain("api/files/[id].get.ts");
      expect(report).not.toContain("api/jobs/index.post.ts");
      expect(report).not.toContain("/health.get.ts:");
      expect(report).not.toContain("__facilisx");
      expect(report).not.toContain("/_openapi.get.ts:");
      expect(report).not.toContain("packages/nitro/src/routes/manifest.get.ts");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("passes the shipped examples' routes under /api/auth, /api/files and /api/jobs (D-215)", () => {
    const apps = ["examples", "starter"].flatMap((group) => appsWithRoutes(join(REPO_ROOT, group)));
    expect(apps.length, "no app with server routes under examples/ or starter/").toBeGreaterThan(0);
    const parser = createOxcParser();
    const reserved = apps.flatMap((app) =>
      scanApp(app, relative(REPO_ROOT, app), parser).violations.filter((entry) =>
        entry.includes("reserved-route-prefix"),
      ),
    );
    expect(reserved, "framework paths shadowed by shipped apps:\n" + reserved.join("\n")).toEqual(
      [],
    );
  });
});
