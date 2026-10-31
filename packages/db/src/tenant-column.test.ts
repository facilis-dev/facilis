import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyStatements } from "./migrator.ts";
import { ensureAppRole, runWithPolicyScope } from "./policy.ts";
import { ownerIsolationPolicy, policyCreateSql, tenantIsolationPolicy } from "./rls.ts";
import { tenantColumn, tenantDefaultSql } from "./tenant-column.ts";

const TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// The same shape a scoped app table has: defaulted tenant column + both policies.
const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantColumn(),
    ownerId: uuid("owner_id").notNull(),
    title: text("title").notNull(),
  },
  () => [tenantIsolationPolicy(), ownerIsolationPolicy()],
);

function tenantColumnDefault(): unknown {
  const column = getTableConfig(todos).columns.find((entry) => entry.name === "tenant_id");
  if (column === undefined) throw new Error("todos.tenant_id is missing from the table config");
  return column.default;
}

describe("tenant column default (D-040)", () => {
  it("renders the same GUC expression the RLS policies read", () => {
    const dialect = new PgDialect();
    const fromColumn = dialect.sqlToQuery(tenantColumnDefault() as SQL).sql;
    expect(tenantColumnDefault()).toBeDefined();
    expect(fromColumn).toBe(dialect.sqlToQuery(tenantDefaultSql()).sql);
    expect(fromColumn).toBe("nullif(current_setting('app.tenant_id', true), '')::uuid");
  });

  describe("inside the real policy scope", () => {
    let db: FacilisDb;

    beforeAll(async () => {
      db = await createDb();
      await applyStatements(db, [
        `CREATE TABLE todos (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid,
          owner_id uuid NOT NULL,
          title text NOT NULL
        )`,
        "ALTER TABLE todos ENABLE ROW LEVEL SECURITY",
        policyCreateSql("todos", tenantIsolationPolicy("tenant_id")),
        policyCreateSql("todos", ownerIsolationPolicy("owner_id")),
      ]);
      await ensureAppRole(db);
    }, 30_000);

    afterAll(async () => {
      await db.close();
    });

    const scope = { tenantId: TENANT, userId: USER, roles: [] as string[] };

    it("fills an insert that never names the tenant, from app.tenant_id", async () => {
      const rows = await runWithPolicyScope(db, scope, async (tx) => {
        const inserted = await tx.execute(
          sql`insert into todos (owner_id, title) values (${USER}, 'auto') returning tenant_id, owner_id`,
        );
        return inserted.rows;
      });

      expect(rows).toEqual([{ tenant_id: TENANT, owner_id: USER }]);
    });

    it("still rejects an insert that names another tenant (RLS WITH CHECK)", async () => {
      await expect(
        runWithPolicyScope(db, scope, async (tx) => {
          await tx.execute(
            sql`insert into todos (tenant_id, owner_id, title) values (${OTHER_TENANT}, ${USER}, 'cross')`,
          );
        }),
      ).rejects.toMatchObject({ cause: { code: "42501" } });
    });

    it("fails loudly instead of guessing when no scope is set", async () => {
      // NULL default -> NOT NULL violation: an unscoped insert can never land in a tenant.
      await expect(
        db.db.execute(sql`insert into todos (owner_id, title) values (${USER}, 'unscoped')`),
      ).rejects.toMatchObject({ cause: { code: "23502" } });
    });
  });
});
