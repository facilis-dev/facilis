import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import type { Diagnostic } from "../types.ts";
import { emptyConfigFacts } from "./config.ts";
import { buildJobFacts } from "./jobs.ts";
import { buildJobRelationFacts } from "./job-relations.ts";
import { rawSqlSystemWriteDiagnostics } from "./raw-sql-system-write.ts";
import { buildRouteRelationFacts } from "./route-relations.ts";
import { buildRouteFacts } from "./routes.ts";
import { buildSchemaFacts } from "./schema.ts";
import { buildViewFacts } from "./views.ts";

const CORE = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';
const JOB = 'import { defineJob } from "@facilis.dev/core";\n';
const SCHEMA =
  'import { pgTable, uuid } from "drizzle-orm/pg-core";\n' +
  'export const todos = pgTable("todos", { id: uuid("id").primaryKey() });\n';
const CODE = "raw-sql-system-write";

function handler(config: string, body: string): string {
  return CORE + "export default defineAuthorizedHandler(" + config + ", " + body + ");\n";
}

function routeDiagnostics(
  routeFile: string,
  source: string,
  extra: Record<string, string> = {},
): Diagnostic[] {
  const files = new Map(Object.entries({ "db/schema.ts": SCHEMA, ...extra, [routeFile]: source }));
  const graph = createModuleGraph({ files, parser: createOxcParser() });
  const config = emptyConfigFacts();
  const facts = buildRouteFacts(graph, config);
  const schema = buildSchemaFacts(graph, config);
  const views = buildViewFacts(graph);
  const relations = buildRouteRelationFacts(graph, facts.routes, schema.tables, views.views);
  return rawSqlSystemWriteDiagnostics(relations.routes.map((route) => route.relations));
}

function jobDiagnostics(jobFile: string, source: string): Diagnostic[] {
  const files = new Map(Object.entries({ "db/schema.ts": SCHEMA, [jobFile]: source }));
  const graph = createModuleGraph({ files, parser: createOxcParser() });
  const config = emptyConfigFacts();
  const schema = buildSchemaFacts(graph, config);
  const views = buildViewFacts(graph);
  const jobs = buildJobFacts(graph).jobs;
  const relations = buildJobRelationFacts(graph, jobs, schema.tables, views.views);
  return rawSqlSystemWriteDiagnostics(Object.values(relations.relations));
}

const SQL_CONFIG = '{ permission: [], dbTables: [], rawSql: true }';

function execute(sql: string): string {
  return handler(
    SQL_CONFIG,
    "async (_event, { db }) => db.execute(" + sql + ")",
  );
}

describe("raw SQL system-table write check (SPEC §8.4, D-214)", () => {
  it("errors on a literal INSERT into a seed-only auth table", () => {
    const diagnostics = routeDiagnostics(
      "server/routes/api/users.post.ts",
      execute('"INSERT INTO role_permissions (role, permission) VALUES (\'user\', \'todos:read\')"'),
    );
    expect(diagnostics.map((entry) => entry.code)).toEqual([CODE]);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain("role_permissions");
  });

  it("errors on template-literal UPDATE/DELETE/DDL statements", () => {
    for (const sql of [
      "`UPDATE sessions SET revoked_at = now()`",
      "`DELETE FROM user_roles WHERE role = 'admin'`",
      "`DROP TABLE roles`",
      "`ALTER TABLE sessions ADD COLUMN x int`",
      "`CREATE INDEX sessions_lookup ON sessions (user_id)`",
    ]) {
      const diagnostics = routeDiagnostics("server/routes/api/users.post.ts", execute(sql));
      expect(diagnostics.map((entry) => entry.code), sql).toEqual([CODE]);
    }
  });

  it("errors through the elevated sudo/system clients and the Drizzle sql tag", () => {
    const elevated = handler(
      SQL_CONFIG,
      'async (_event, { sudo }) => sudo({ operation: "x", reason: "y", tables: [] }, (db) => db.execute("DELETE FROM sessions"))',
    );
    expect(routeDiagnostics("server/routes/api/users.post.ts", elevated).map((e) => e.code)).toEqual([
      CODE,
    ]);
    const tagged = handler(
      SQL_CONFIG,
      "async (_event, { system }) => system({ operation: \"x\", reason: \"y\", tables: [] }, (db) => db.execute(sql`UPDATE roles SET name = 'x'`))",
    );
    expect(routeDiagnostics("server/routes/api/users.post.ts", tagged).map((e) => e.code)).toEqual([
      CODE,
    ]);
  });

  it("passes a SELECT through sudo and a write to an ordinary table", () => {
    const reads = handler(
      SQL_CONFIG,
      'async (_event, { sudo }) => sudo({ operation: "x", reason: "y", tables: [] }, (db) => db.execute("SELECT * FROM role_permissions"))',
    );
    expect(routeDiagnostics("server/routes/api/users.post.ts", reads)).toEqual([]);
    const other = execute('"INSERT INTO todos (id) VALUES (gen_random_uuid())"');
    expect(routeDiagnostics("server/routes/api/users.post.ts", other)).toEqual([]);
  });

  it("skips dynamic and unreadable SQL instead of guessing", () => {
    const dynamic = handler(
      SQL_CONFIG,
      "async (_event, { db }) => db.execute(statement)",
    );
    expect(routeDiagnostics("server/routes/api/users.post.ts", dynamic)).toEqual([]);
    const interpolated = handler(
      SQL_CONFIG,
      "async (_event, { db }) => db.execute(`INSERT INTO ${table} VALUES (1)`)",
    );
    expect(routeDiagnostics("server/routes/api/users.post.ts", interpolated)).toEqual([]);
    // A quoted value that happens to contain SQL text is data, not a statement.
    const data = execute('"SELECT 1 FROM todos WHERE note = \'INSERT INTO roles\'"');
    expect(routeDiagnostics("server/routes/api/users.post.ts", data)).toEqual([]);
  });

  it("errors on a job whose system-scoped db executes the literal write", () => {
    const source =
      JOB +
      'export default defineJob({ name: "purge-sessions", dbTables: [], rawSql: true, async run({ db }) { await db.execute("DELETE FROM sessions"); } });\n';
    const diagnostics = jobDiagnostics("server/jobs/purge-sessions.ts", source);
    expect(diagnostics.map((entry) => entry.code)).toEqual([CODE]);
  });

  it("does not scan a standalone seed file (framework seed owns those statements)", () => {
    const seed =
      'import { db } from "~/db/client";\nexport const seed = db.execute("INSERT INTO roles (name) VALUES (\'admin\')");\n';
    expect(routeDiagnostics("server/routes/api/users.post.ts", execute('"SELECT 1"'), {
      "server/db/seed.ts": seed,
    })).toEqual([]);
  });
});
