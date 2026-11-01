import { sql } from "drizzle-orm";
import { getTableConfig, pgTable, serial, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyStatements } from "./migrator.ts";
import { ensureAppRole, runWithPolicyScope, type PolicyScope } from "./policy.ts";
import { ownerIsolationPolicy, policyCreateSql, tenantIsolationPolicy } from "./rls.ts";
import { startPostgresServer, type PostgresTestServer } from "../test-fixtures/postgres-server.ts";

const TENANT_T = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_U = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OWNER_T = "11111111-1111-1111-1111-111111111111";
const OWNER_T2 = "22222222-2222-2222-2222-222222222222";
const OWNER_U = "33333333-3333-3333-3333-333333333333";

// The real composition: restrictive tenant isolation AND a permissive owner policy.
const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    ownerId: uuid("owner_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
  },
  () => [tenantIsolationPolicy("tenant_id"), ownerIsolationPolicy("owner_id")],
).enableRLS();

describe("policy scope over the postgres wire protocol", () => {
  let server: PostgresTestServer;
  let db: FacilisDb;

  beforeAll(async () => {
    server = await startPostgresServer();
    db = await createDb({ driver: "postgres", url: server.url, schema: { documents } });
    await applyStatements(db, [
      "CREATE TABLE documents (id serial PRIMARY KEY, title text NOT NULL, owner_id uuid NOT NULL, tenant_id uuid NOT NULL)",
      "ALTER TABLE documents ENABLE ROW LEVEL SECURITY",
      ...getTableConfig(documents).policies.map((policy) => policyCreateSql("documents", policy)),
    ]);
    // The pool connects as the PGlite superuser, which bypasses RLS; seeding here is the
    // privileged bootstrap that migrations perform in a real deployment.
    await db.db.insert(documents).values([
      { title: "t-doc-1", ownerId: OWNER_T, tenantId: TENANT_T },
      { title: "t-doc-2", ownerId: OWNER_T, tenantId: TENANT_T },
      { title: "t-doc-3", ownerId: OWNER_T2, tenantId: TENANT_T },
      { title: "u-doc-1", ownerId: OWNER_U, tenantId: TENANT_U },
    ]);
    await ensureAppRole(db);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await server.stop();
  });

  async function visibleTitles(scope: PolicyScope): Promise<string[]> {
    return runWithPolicyScope(db, scope, async (tx) => {
      const rows = await tx
        .select({ title: documents.title })
        .from(documents)
        .orderBy(documents.title);
      return rows.map((row) => row.title);
    });
  }

  it("provisioned facilis_app as NOSUPERUSER NOBYPASSRLS", async () => {
    const result = await db.db.execute(
      sql.raw("select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'facilis_app'"),
    );
    expect(result.rows[0]).toEqual({
      rolname: "facilis_app",
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  it("returns only the rows the tenant AND owner policies allow", async () => {
    await expect(visibleTitles({ tenantId: TENANT_T, userId: OWNER_T })).resolves.toEqual([
      "t-doc-1",
      "t-doc-2",
    ]);
    await expect(visibleTitles({ tenantId: TENANT_T, userId: OWNER_T2 })).resolves.toEqual([
      "t-doc-3",
    ]);
    await expect(visibleTitles({ tenantId: TENANT_U, userId: OWNER_U })).resolves.toEqual([
      "u-doc-1",
    ]);
    // The owner policy would match, but the restrictive tenant policy forbids the row.
    await expect(visibleTitles({ tenantId: TENANT_T, userId: OWNER_U })).resolves.toEqual([]);
  });

  it("returns no rows to an unscoped read as facilis_app", async () => {
    await expect(visibleTitles({})).resolves.toEqual([]);
  });

  it("runs the callback as facilis_app and clears the GUCs after commit", async () => {
    const inside = await runWithPolicyScope(
      db,
      { tenantId: TENANT_T, userId: OWNER_T },
      async (tx) => {
        const result = await tx.execute(
          sql.raw("select current_user as role, current_setting('app.tenant_id', true) as tenant"),
        );
        return result.rows[0];
      },
    );
    expect(inside).toEqual({ role: "facilis_app", tenant: TENANT_T });

    const outside = await db.db.execute(
      sql.raw("select current_setting('app.tenant_id', true) as tenant"),
    );
    expect(outside.rows[0]).toEqual({ tenant: "" });
  });

  it("inserts through the serial sequence granted to facilis_app", async () => {
    const inserted = await runWithPolicyScope(
      db,
      { tenantId: TENANT_T, userId: OWNER_T },
      async (tx) => {
        const rows = await tx
          .insert(documents)
          .values({ title: "t-doc-new", ownerId: OWNER_T, tenantId: TENANT_T })
          .returning({ id: documents.id });
        return rows[0];
      },
    );
    expect(inserted?.id).toBe(5);
    await expect(visibleTitles({ tenantId: TENANT_T, userId: OWNER_T })).resolves.toEqual([
      "t-doc-1",
      "t-doc-2",
      "t-doc-new",
    ]);
  });

  it("rejects an insert that crosses the tenant policy", async () => {
    await expect(
      runWithPolicyScope(db, { tenantId: TENANT_T, userId: OWNER_T }, async (tx) => {
        await tx.insert(documents).values({
          title: "leak",
          ownerId: OWNER_T,
          tenantId: TENANT_U,
        });
      }),
    ).rejects.toThrow();
  });

  it("grants sequences created after ensureAppRole via default privileges", async () => {
    await db.db.execute(
      sql.raw("CREATE TABLE later_notes (id serial PRIMARY KEY, label text NOT NULL)"),
    );
    const inserted = await runWithPolicyScope(db, {}, async (tx) => {
      const result = await tx.execute(
        sql.raw("insert into later_notes (label) values ('later') returning id"),
      );
      return result.rows[0];
    });
    expect(inserted).toMatchObject({ id: expect.any(Number) });
  });
});
