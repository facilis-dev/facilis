import { describe, expect, it } from "vitest";

import { create, rulesOf, update, validate } from "./testing/fixtures.ts";

const CORE = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';
const IMPORT = 'import { todos } from "~/db/schema";\n';
const RULE = "get-side-effect-free";

function route(body: string, config = '{ permission: ["todos:write"], dbTables: ["todos"] }'): string {
  return CORE + IMPORT + "export default defineAuthorizedHandler(" + config + ", " + body + ");\n";
}

const READ_ONLY = route(
  "async (_event, { db }) => db.select().from(todos)",
  '{ permission: ["todos:read"], dbTables: ["todos"] }',
);

describe("rule 21 get-side-effect-free (SPEC §8.6, D-212)", () => {
  it("rejects a direct insert in a GET handler", () => {
    const { result } = validate([
      create("server/routes/api/todos.get.ts", route("async (_event, { db }) => db.insert(todos).values({})")),
    ]);
    expect(rulesOf(result.errors)).toContain(RULE);
    expect(result.ok).toBe(false);
  });

  it("rejects a write reached through a project-local helper", () => {
    const source =
      route("async (_event, { db }) => wipe(db)") +
      "function wipe(client: { delete: (relation: unknown) => unknown }) { return client.delete(todos); }\n";
    const { result } = validate([create("server/routes/api/todos.get.ts", source)]);
    expect(rulesOf(result.errors)).toContain(RULE);
    expect(result.ok).toBe(false);
  });

  it("rejects a job enqueue in a GET handler", () => {
    const { result } = validate([
      create(
        "server/routes/api/jobs.get.ts",
        route('async (_event, { jobs }) => jobs.enqueue("sync", {})', '{ permission: [], dbTables: [] }'),
      ),
    ]);
    expect(rulesOf(result.errors)).toContain(RULE);
    expect(result.ok).toBe(false);
  });

  it("passes a read-only GET", () => {
    const { result } = validate([create("server/routes/api/todos.get.ts", READ_ONLY)]);
    expect(rulesOf(result.errors)).not.toContain(RULE);
    expect(rulesOf(result.warnings)).not.toContain(RULE);
    expect(result.ok).toBe(true);
  });

  it("does not fire on an unsafe-method write", () => {
    const { result } = validate([
      create("server/routes/api/todos.post.ts", route("async (_event, { db }) => db.insert(todos).values({})")),
    ]);
    expect(rulesOf(result.errors)).not.toContain(RULE);
  });

  it("exempts the framework SSO GET/ACS pair (D-120)", () => {
    const write = route(
      'async (_event, { system }) => system({ actor: "system:auth", operation: "auth:sso", reason: "y", tables: ["todos"] }, (systemDb) => systemDb.insert(todos).values({}))',
      '{ permission: [], dbTables: ["todos"] }',
    );
    const { result } = validate([
      create("server/routes/api/auth/sso/[provider]/start.get.ts", write),
      create("server/routes/api/auth/sso/[provider]/callback.get.ts", write),
    ]);
    expect(rulesOf(result.errors)).not.toContain(RULE);
    // D-215 makes an app route under /api/auth/sso an error; D-212 still exempts the pair from
    // the GET side-effect rule, so reserved-route-prefix is the only finding.
    expect(result.ok).toBe(false);
    expect(result.errors.every((entry) => entry.rule === "reserved-route-prefix")).toBe(true);
  });

  it("warns, without blocking, when a package helper receives the client (opaque body)", () => {
    const source =
      CORE +
      'import { ownerIsolationPolicy } from "@facilis.dev/db";\n' +
      "export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async (_event, { db }) => ownerIsolationPolicy(db));\n";
    const { result } = validate([create("server/routes/api/todos.get.ts", source)]);
    expect(rulesOf(result.warnings)).toContain(RULE);
    expect(rulesOf(result.errors)).not.toContain(RULE);
    expect(result.ok).toBe(true);
  });

  it("audits an untouched GET whose shared helper a patch turns into a write", () => {
    const getter =
      CORE +
      'import { load } from "~/server/utils/load";\n' +
      "export default defineAuthorizedHandler({ permission: [], dbTables: [\"todos\"] }, async (_event, { db }) => load(db));\n";
    const helper =
      IMPORT +
      "export function load(client: { insert: (relation: unknown) => { values: (row: unknown) => unknown } }) { return client.insert(todos).values({}); }\n";
    const { result } = validate([update("server/utils/load.ts", helper)], {
      sources: {
        "server/routes/api/todos.get.ts": getter,
        "server/utils/load.ts":
          IMPORT + "export function load(client: { select: () => { from: (relation: unknown) => unknown } }) { return client.select().from(todos); }\n",
      },
    });
    expect(rulesOf(result.errors)).toContain(RULE);
    expect(result.ok).toBe(false);
  });
});
