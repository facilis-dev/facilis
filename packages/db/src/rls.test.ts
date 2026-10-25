import { sql } from "drizzle-orm";
import { getTableConfig, PgDialect, pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyStatements } from "./migrator.ts";
import { ensureAppRole, runWithPolicyScope, type PolicyScope } from "./policy.ts";
import {
  ownerIsolationPolicy,
  policyCreateSql,
  rlsForTable,
  rolePolicy,
  tenantIsolationPolicy,
  withRls,
} from "./rls.ts";

const TENANT_T = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_U = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ADMIN_T = "11111111-1111-1111-1111-111111111111";
const MANAGER_T = "22222222-2222-2222-2222-222222222222";
const ADMIN_U = "33333333-3333-3333-3333-333333333333";
const USER_T = "44444444-4444-4444-4444-444444444444";

const dialect = new PgDialect();

// Phase 0 verified composition: restrictive tenant isolation AND (admin OR owner).
const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    ownerId: uuid("owner_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
  },
  () => [
    tenantIsolationPolicy("tenant_id"),
    pgPolicy("documents_read", {
      for: "select",
      using: sql`
        nullif(current_setting('app.roles', true), '')::jsonb ? 'admin'
        OR owner_id = nullif(current_setting('app.user_id', true), '')::uuid
      `,
    }),
  ],
).enableRLS();

// Exercises the row-role policy: app.roles::jsonb ? row.required_role.
const roleDocuments = pgTable(
  "role_documents",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    requiredRole: text("required_role").notNull(),
  },
  () => [tenantIsolationPolicy("tenant_id"), rolePolicy("required_role")],
).enableRLS();

async function visibleRoleIds(db: FacilisDb, roles: readonly string[]): Promise<string[]> {
  return runWithPolicyScope(db, { tenantId: TENANT_T, roles }, async (tx) => {
    const rows = await tx
      .select({ id: roleDocuments.id })
      .from(roleDocuments)
      .orderBy(roleDocuments.id);
    return rows.map((row) => row.id);
  });
}

function enableAndCreate(tableName: string, policiesSql: readonly string[]): string[] {
  return [`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`, ...policiesSql];
}

describe("RLS generators and policy-scoped queries", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createDb();
    await applyStatements(db, [
      "CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, owner_id uuid NOT NULL, tenant_id uuid NOT NULL)",
      `INSERT INTO documents (title, owner_id, tenant_id) VALUES
        ('t-doc-1', '${MANAGER_T}', '${TENANT_T}'),
        ('t-doc-2', '${MANAGER_T}', '${TENANT_T}'),
        ('t-doc-3', '${ADMIN_T}', '${TENANT_T}'),
        ('u-doc-1', '${ADMIN_U}', '${TENANT_U}')`,
      ...enableAndCreate(
        "documents",
        getTableConfig(documents).policies.map((policy) => policyCreateSql("documents", policy)),
      ),
      "CREATE TABLE role_documents (id text PRIMARY KEY, tenant_id uuid NOT NULL, required_role text NOT NULL)",
      `INSERT INTO role_documents (id, tenant_id, required_role) VALUES
        ('admin-doc', '${TENANT_T}', 'admin'),
        ('editor-doc', '${TENANT_T}', 'editor')`,
      ...enableAndCreate(
        "role_documents",
        getTableConfig(roleDocuments).policies.map((policy) =>
          policyCreateSql("role_documents", policy),
        ),
      ),
    ]);
    await ensureAppRole(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
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

  it("reproduces the Phase 0 composition table exactly", async () => {
    await expect(
      visibleTitles({ tenantId: TENANT_T, userId: ADMIN_T, roles: ["admin"] }),
    ).resolves.toEqual(["t-doc-1", "t-doc-2", "t-doc-3"]);
    await expect(
      visibleTitles({ tenantId: TENANT_U, userId: ADMIN_U, roles: ["admin"] }),
    ).resolves.toEqual(["u-doc-1"]);
    await expect(
      visibleTitles({ tenantId: TENANT_T, userId: MANAGER_T, roles: ["manager"] }),
    ).resolves.toEqual(["t-doc-1", "t-doc-2"]);
    await expect(
      visibleTitles({ tenantId: TENANT_T, userId: USER_T, roles: ["user"] }),
    ).resolves.toEqual([]);
  });

  it("enforces tenant isolation through the real app role, not a manual SET ROLE", async () => {
    // A manager scoped to tenant U must not see tenant-T rows it owns.
    await expect(
      visibleTitles({ tenantId: TENANT_U, userId: MANAGER_T, roles: ["manager"] }),
    ).resolves.toEqual([]);
    // No tenant scope => the restrictive policy matches no rows.
    await expect(visibleTitles({ userId: ADMIN_T, roles: ["admin"] })).resolves.toEqual([]);
  });

  it("runs callbacks as the non-superuser facilis_app role", async () => {
    const identity = await runWithPolicyScope(db, {}, async (tx) => {
      const result = await tx.execute(sql`select current_user as role`);
      return result.rows[0];
    });
    expect(identity).toEqual({ role: "facilis_app" });
  });

  it("sets the three GUCs inside the scope and clears them after commit", async () => {
    const inside = await runWithPolicyScope(
      db,
      { tenantId: TENANT_T, userId: MANAGER_T, roles: ["manager"] },
      async (tx) => {
        const result = await tx.execute(sql`
          select
            current_setting('app.tenant_id', true) as tenant,
            current_setting('app.user_id', true) as "user",
            current_setting('app.roles', true) as roles
        `);
        return result.rows[0];
      },
    );
    expect(inside).toEqual({ tenant: TENANT_T, user: MANAGER_T, roles: '["manager"]' });

    const outside = await db.db.execute(sql`
      select
        current_user as role,
        current_setting('app.tenant_id', true) as tenant,
        current_setting('app.user_id', true) as "user",
        current_setting('app.roles', true) as roles
    `);
    // Transaction-local SET/config reverts to the session default, which is '' (not NULL).
    expect(outside.rows[0]).toEqual({ role: "postgres", tenant: "", user: "", roles: "" });
  });

  it("passes tenant ids as set_config parameters, never as SQL text", async () => {
    const injected = "x'; drop table documents; --";
    const observed = await runWithPolicyScope(db, { tenantId: injected }, async (tx) => {
      const result = await tx.execute(sql`select current_setting('app.tenant_id', true) as tenant`);
      return result.rows[0];
    });
    expect(observed).toEqual({ tenant: injected });

    const count = await db.db.execute(sql`select count(*)::int as count from documents`);
    expect(count.rows[0]).toEqual({ count: 4 });
  });

  it("emits tenant isolation AS RESTRICTIVE with the nullif GUC guard", () => {
    const config = getTableConfig(documents);
    expect(config.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "documents_read",
    ]);
    const tenantPolicy = config.policies[0];
    if (tenantPolicy === undefined || tenantPolicy.using === undefined) {
      throw new Error("tenant isolation policy is missing its USING expression");
    }
    expect(tenantPolicy.as).toBe("restrictive");
    expect(tenantPolicy.for).toBe("all");
    expect(dialect.sqlToQuery(tenantPolicy.using).sql).toContain(
      "nullif(current_setting('app.tenant_id', true), '')::uuid",
    );
    expect(policyCreateSql("documents", tenantPolicy)).toMatch(/ AS RESTRICTIVE /);
    expect(policyCreateSql("documents", tenantPolicy)).not.toMatch(/\bTO\b/);
  });

  it("emits permissive owner and row-role policies that read app GUCs", () => {
    const owner = ownerIsolationPolicy("owner_id");
    expect(owner.name).toBe("owner_isolation");
    expect(owner.as ?? "permissive").toBe("permissive");
    expect(owner.using).toBeDefined();
    expect(dialect.sqlToQuery(owner.using ?? sql``).sql).toContain(
      "nullif(current_setting('app.user_id', true), '')::uuid",
    );

    const role = rolePolicy("required_role");
    expect(role.name).toBe("role_access");
    expect(dialect.sqlToQuery(role.using ?? sql``).sql).toContain(
      "nullif(current_setting('app.roles', true), '')::jsonb ? ",
    );

    const extras = withRls({
      tenantColumn: "tenant_id",
      ownerColumn: "owner_id",
      rolesColumn: "required_role",
    });
    expect(extras.enableRLS).toBe(true);
    expect(extras.policies.map((policy) => policy.name)).toEqual([
      "tenant_isolation",
      "owner_isolation",
      "role_access",
    ]);
    expect(rlsForTable().policies).toHaveLength(1);
  });

  it("filters rows by the caller's app roles through rolePolicy", async () => {
    await expect(visibleRoleIds(db, ["admin"])).resolves.toEqual(["admin-doc"]);
    await expect(visibleRoleIds(db, ["editor"])).resolves.toEqual(["editor-doc"]);
    await expect(visibleRoleIds(db, [])).resolves.toEqual([]);
  });

  it("survives the post-RESET empty-string GUC nuance", async () => {
    await db.db.execute(sql.raw("RESET app.roles"));
    const reset = await db.db.execute(sql`select current_setting('app.roles', true) as value`);
    expect(reset.rows[0]).toEqual({ value: "" });

    // A naive cast explodes on the empty string; the policy guard must not.
    // Drizzle wraps driver errors, so the Postgres message lives on `cause`.
    await expect(
      db.db.execute(sql`select current_setting('app.roles', true)::jsonb`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/invalid input syntax for type json/) },
    });

    const safe = await db.db.execute(sql`
      select (nullif(current_setting('app.roles', true), '')::jsonb ? 'admin') is not true as ok
    `);
    expect(safe.rows[0]).toEqual({ ok: true });
  });
});
