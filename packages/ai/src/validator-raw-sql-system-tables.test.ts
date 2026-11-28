import { describe, expect, it } from "vitest";

import { create, rulesOf, validate } from "./testing/fixtures.ts";

const CORE = 'import { defineAuthorizedHandler } from "@facilis.dev/core";\n';
const RULE = "raw-sql-system-table-write";

function route(body: string): string {
  return (
    CORE +
    'export default defineAuthorizedHandler({ permission: [], dbTables: [], rawSql: { reason: "raw SQL fixture" } }, ' +
    body +
    ");\n"
  );
}

function execute(sql: string): string {
  return route("async (_event, { db }) => db.execute(" + sql + ")");
}

describe("rule 22 raw-sql-system-table-write (SPEC §8.4, D-214)", () => {
  it("rejects a literal INSERT into role_permissions", () => {
    const { result } = validate([
      create(
        "server/routes/api/users.post.ts",
        execute(
          "\"INSERT INTO role_permissions (role, permission) VALUES ('user', 'todos:read')\"",
        ),
      ),
    ]);
    expect(rulesOf(result.errors)).toContain(RULE);
    expect(result.ok).toBe(false);
  });

  it("rejects a literal write inside an audited sudo callback", () => {
    const source = route(
      'async (_event, { sudo }) => sudo({ operation: "x", reason: "y", tables: [] }, (db) => db.execute("DELETE FROM sessions"))',
    );
    const { result } = validate([create("server/routes/api/users.post.ts", source)]);
    expect(rulesOf(result.errors)).toContain(RULE);
    expect(result.ok).toBe(false);
  });

  it("rejects a job whose system-scoped db executes the literal write", () => {
    const source =
      'import { defineJob } from "@facilis.dev/core";\n' +
      'export default defineJob({ name: "purge-sessions", dbTables: [], rawSql: true, async run({ db }) { await db.execute("DELETE FROM sessions"); } });\n';
    const { result } = validate([create("server/jobs/purge-sessions.ts", source)]);
    expect(rulesOf(result.errors)).toContain(RULE);
    expect(result.ok).toBe(false);
  });

  it("passes a SELECT through sudo and a write to an ordinary table", () => {
    const read = route(
      'async (_event, { sudo }) => sudo({ operation: "x", reason: "y", tables: [] }, (db) => db.execute("SELECT * FROM role_permissions"))',
    );
    const { result } = validate([create("server/routes/api/users.post.ts", read)]);
    expect(rulesOf(result.errors)).not.toContain(RULE);
    expect(result.ok).toBe(true);
    const other = validate([
      create("server/routes/api/todos.post.ts", execute('"INSERT INTO todos (id) VALUES (1)"')),
    ]);
    expect(rulesOf(other.result.errors)).not.toContain(RULE);
  });

  it("skips dynamic SQL instead of guessing", () => {
    const dynamic = route("async (_event, { db }) => db.execute(statement)");
    const { result } = validate([create("server/routes/api/users.post.ts", dynamic)]);
    expect(rulesOf(result.errors)).not.toContain(RULE);
    expect(result.ok).toBe(true);
    const interpolated = route(
      "async (_event, { db }) => db.execute(`INSERT INTO ${table} VALUES (1)`)",
    );
    const other = validate([create("server/routes/api/users.post.ts", interpolated)]);
    expect(rulesOf(other.result.errors)).not.toContain(RULE);
  });
});
