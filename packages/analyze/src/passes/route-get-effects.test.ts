import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import type { Diagnostic } from "../types.ts";
import { emptyConfigFacts } from "./config.ts";
import { routeGetEffectDiagnostics } from "./route-get-effects.ts";
import { routeLocationFromFile } from "./route-location.ts";
import { buildRouteRelationFacts } from "./route-relations.ts";
import { buildRouteFacts } from "./routes.ts";
import { buildSchemaFacts } from "./schema.ts";
import { buildViewFacts } from "./views.ts";

const CORE = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';
const SCHEMA =
  'import { pgTable, uuid } from "drizzle-orm/pg-core";\n' +
  'export const todos = pgTable("todos", { id: uuid("id").primaryKey() });\n' +
  'export const notes = pgTable("notes", { id: uuid("id").primaryKey() });\n';
const IMPORT = 'import { todos, notes } from "~/db/schema";\n';
const QUERY = "sql`select * from notes`";
const CODE = "route-get-side-effect";

function handler(config: string, body: string): string {
  return CORE + "export default defineAuthorizedHandler(" + config + ", " + body + ");\n";
}

function effects(routeFile: string, source: string, extra: Record<string, string> = {}): Diagnostic[] {
  const files = new Map(Object.entries({ "db/schema.ts": SCHEMA, ...extra, [routeFile]: source }));
  const graph = createModuleGraph({ files, parser: createOxcParser() });
  const config = emptyConfigFacts();
  const facts = buildRouteFacts(graph, config);
  const schema = buildSchemaFacts(graph, config);
  const views = buildViewFacts(graph);
  const relations = buildRouteRelationFacts(graph, facts.routes, schema.tables, views.views);
  return routeGetEffectDiagnostics(relations.routes);
}

function severities(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.filter((entry) => entry.code === CODE).map((entry) => entry.severity);
}

describe("GET side-effect check (SPEC §8.6, D-212)", () => {
  it("errors on a direct insert, update or delete in a GET handler", () => {
    for (const write of ["insert(todos).values({})", "update(todos).set({})", "delete(todos)"]) {
      const diagnostics = effects(
        "server/routes/api/todos.get.ts",
        IMPORT + handler('{ permission: [], dbTables: ["todos"] }', "async (_event, { db }) => db." + write),
      );
      expect(severities(diagnostics), write).toEqual(["error"]);
    }
  });

  it("errors on a write reached through a project-local helper", () => {
    const diagnostics = effects(
      "server/routes/api/todos.get.ts",
      IMPORT +
        handler('{ permission: [], dbTables: ["notes"] }', "async (_event, { db }) => wipe(db)") +
        "function wipe(client: { delete: (relation: unknown) => unknown }) { return client.delete(notes); }\n",
    );
    expect(severities(diagnostics)).toEqual(["error"]);
  });

  it("follows a helper imported from another project file", () => {
    const diagnostics = effects(
      "server/routes/api/todos.get.ts",
      CORE +
        'import { wipe } from "~/server/utils/wipe";\n' +
        handler('{ permission: [], dbTables: ["notes"] }', "async (_event, { db }) => wipe(db)"),
      {
        "server/utils/wipe.ts":
          IMPORT +
          "export function wipe(client: { delete: (relation: unknown) => unknown }) { return client.delete(notes); }\n",
      },
    );
    expect(severities(diagnostics)).toEqual(["error"]);
    expect(diagnostics[0]?.source?.file).toBe("server/utils/wipe.ts");
  });

  it("errors on db.execute even with rawSql: true (execute may write)", () => {
    const diagnostics = effects(
      "server/routes/api/raw.get.ts",
      handler('{ permission: [], dbTables: [], rawSql: true }', "async (_event, { db }) => db.execute(" + QUERY + ")"),
    );
    expect(severities(diagnostics)).toEqual(["error"]);
  });

  it("errors on a write inside an audited elevation", () => {
    const diagnostics = effects(
      "server/routes/api/todos.get.ts",
      IMPORT +
        handler(
          '{ permission: [], dbTables: ["notes"] }',
          'async (_event, { system }) => system({ actor: "system:x", operation: "x", reason: "y", tables: ["notes"] }, (systemDb) => systemDb.insert(notes).values({}))',
        ),
    );
    expect(severities(diagnostics)).toEqual(["error"]);
  });

  it("errors on job enqueue and cancel, but not on queue reads", () => {
    const enqueue = effects(
      "server/routes/api/jobs.get.ts",
      handler('{ permission: [], dbTables: [] }', 'async (_event, { jobs }) => jobs.enqueue("sync", {})'),
    );
    expect(severities(enqueue)).toEqual(["error"]);
    const viaCtx = effects(
      "server/routes/api/jobs.get.ts",
      handler('{ permission: [], dbTables: [] }', 'async (_event, ctx) => ctx.jobs.enqueue("sync", {})'),
    );
    expect(severities(viaCtx)).toEqual(["error"]);
    const cancel = effects(
      "server/routes/api/jobs.get.ts",
      handler('{ permission: [], dbTables: [] }', 'async (_event, { jobs }) => jobs.cancel("id")'),
    );
    expect(severities(cancel)).toEqual(["error"]);
    const reads = effects(
      "server/routes/api/jobs.get.ts",
      handler('{ permission: [], dbTables: [] }', 'async (_event, { jobs }) => jobs.list()'),
    );
    expect(severities(reads)).toEqual([]);
  });

  it("follows a forwarded queue handle into a local helper", () => {
    const diagnostics = effects(
      "server/routes/api/jobs.get.ts",
      handler('{ permission: [], dbTables: [] }', "async (_event, { jobs }) => enqueueSync(jobs)") +
        'function enqueueSync(queue: { enqueue: (name: string, data: unknown) => unknown }) { return queue.enqueue("sync", {}); }\n',
    );
    expect(severities(diagnostics)).toEqual(["error"]);
  });

  it("passes a read-only GET", () => {
    const diagnostics = effects(
      "server/routes/api/todos.get.ts",
      IMPORT + handler('{ permission: [], dbTables: ["todos"] }', "async (_event, { db }) => db.select().from(todos)"),
    );
    expect(diagnostics).toEqual([]);
  });

  it("does not check unsafe methods", () => {
    const diagnostics = effects(
      "server/routes/api/todos.post.ts",
      IMPORT + handler('{ permission: [], dbTables: ["todos"] }', "async (_event, { db }) => db.insert(todos).values({})"),
    );
    expect(diagnostics).toEqual([]);
  });

  it("checks a method-less (ALL) route, which serves GET too", () => {
    const diagnostics = effects(
      "server/routes/api/todos.ts",
      IMPORT + handler('{ permission: [], dbTables: ["todos"] }', "async (_event, { db }) => db.insert(todos).values({})"),
    );
    expect(severities(diagnostics)).toEqual(["error"]);
  });

  it("exempts the framework SSO GET/ACS pair (D-120)", () => {
    const write =
      IMPORT +
      handler(
        '{ permission: [], dbTables: ["notes"] }',
        'async (_event, { system }) => system({ actor: "system:auth", operation: "auth:sso", reason: "y", tables: ["notes"] }, (systemDb) => systemDb.insert(notes).values({}))',
      );
    for (const file of [
      "server/routes/api/auth/sso/[provider]/start.get.ts",
      "server/routes/api/auth/sso/[provider]/callback.get.ts",
      "server/routes/api/auth/sso/[provider]/callback.post.ts",
    ]) {
      expect(effects(file, write), file).toEqual([]);
    }
    // A non-framework auth GET that writes is still a finding.
    const other = effects("server/routes/api/auth/other.get.ts", write);
    expect(severities(other)).toEqual(["error"]);
  });

  it("exempts the exact email-verification link path, not a prefix (D-156)", () => {
    const opaque =
      CORE +
      'import { consumeEmailVerification } from "@facilis.dev/auth";\n' +
      IMPORT +
      handler(
        '{ permission: [], dbTables: ["notes"] }',
        'async (_event, { system }) => system({ actor: "system:auth", operation: "auth:email:verify", reason: "y", tables: ["notes"] }, (systemDb) => consumeEmailVerification(systemDb, "token"))',
      );
    // The framework link GET is exempt even though its elevated body is opaque.
    expect(effects("server/routes/api/auth/verify-email.get.ts", opaque)).toEqual([]);
    // A neighbouring app path is not the link: the opaque body still warns.
    const other = effects("server/routes/api/auth/verify-email-other.get.ts", opaque);
    expect(severities(other)).toEqual(["warning"]);
  });

  it("exempts the read-only framework blueprint GETs, exact path only (D-212)", () => {
    // Tie the pinned strings to the file-router derivation (index popped, [id] -> {id}).
    expect(routeLocationFromFile("api/auth/clients/index.get.ts")?.path).toBe("/api/auth/clients");
    expect(routeLocationFromFile("api/files/[id].get.ts")?.path).toBe("/api/files/{id}");
    const clients =
      CORE +
      'import { listApiClients } from "@facilis.dev/auth";\n' +
      handler('{ permission: [], dbTables: [] }', "async (_event, { db }) => listApiClients(db)");
    const file =
      CORE +
      'import { sendStoredFile } from "@facilis.dev/nitro/storage";\n' +
      handler('{ permission: [], dbTables: [] }', "async (_event, { db }) => sendStoredFile({ db })");
    // Opaque framework read primitives: the blueprint paths are exempt.
    expect(effects("server/routes/api/auth/clients/index.get.ts", clients)).toEqual([]);
    expect(effects("server/routes/api/files/[id].get.ts", file)).toEqual([]);
    // Near-miss app paths are not the blueprint: the opaque body still warns.
    expect(severities(effects("server/routes/api/auth/clients-extra.get.ts", clients))).toEqual(["warning"]);
    expect(severities(effects("server/routes/api/files/[id]/extra.get.ts", file))).toEqual(["warning"]);
  });

  it("warns, never errors, when a package helper receives the client (opaque body)", () => {
    const diagnostics = effects(
      "server/routes/api/todos.get.ts",
      CORE +
        'import { destroySession } from "@facilis.dev/auth";\n' +
        handler('{ permission: [], dbTables: [] }', 'async (_event, { db }) => destroySession(db, "id")'),
    );
    expect(severities(diagnostics)).toEqual(["warning"]);
  });

  it("warns when the handler body is not inspectable (imported handler)", () => {
    const diagnostics = effects(
      "server/routes/api/todos.get.ts",
      CORE +
        'import { readTodos } from "~/server/utils/read-todos";\n' +
        "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, readTodos);\n",
      { "server/utils/read-todos.ts": "export async function readTodos(): Promise<null> { return null; }\n" },
    );
    expect(severities(diagnostics)).toEqual(["warning"]);
  });
});
