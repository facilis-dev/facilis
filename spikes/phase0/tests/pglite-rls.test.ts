import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A13 + A14 — PGlite boot and RLS smoke test (SPEC §8.4.5, §12 Phase 0).
 *
 * PGlite connects as a superuser ("postgres"), and superusers bypass RLS even
 * with FORCE ROW LEVEL SECURITY. To exercise policies we therefore create a
 * plain non-superuser role and SET ROLE to it — the same thing a real client
 * connection would do. The policies themselves only use app-level GUCs
 * (current_setting('app.roles'/'app.user_id'/'app.tenant_id')), never Postgres
 * roles, matching SPEC §8.4.5's "app roles only" rule.
 */

const TENANT_T = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_U = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ADMIN_T = "11111111-1111-1111-1111-111111111111";
const MANAGER_T = "22222222-2222-2222-2222-222222222222";
const ADMIN_U = "33333333-3333-3333-3333-333333333333";

const SPEC_POLICIES = `
  ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
  CREATE POLICY documents_tenant_isolation ON documents
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  CREATE POLICY documents_read ON documents
    FOR SELECT
    USING (
      current_setting('app.roles', true)::jsonb ? 'admin'
      OR owner_id = current_setting('app.user_id')::uuid
    );
`;

// SPEC §8.4.5 documents "admin (tenant U) sees all documents in tenant U (not T)"
// and "manager sees only their 3 docs". With the verbatim policies above, all
// permissive policies are OR-ed, so neither holds. Marking the tenant policy
// RESTRICTIVE (AND-ed with the permissive read policy) restores the documented
// behaviour. This is a finding about the spec example, not about PGlite.
const RESTRICTIVE_POLICIES = `
  ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
  CREATE POLICY documents_tenant_isolation ON documents
    AS RESTRICTIVE
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  CREATE POLICY documents_read ON documents
    FOR SELECT
    USING (
      current_setting('app.roles', true)::jsonb ? 'admin'
      OR owner_id = current_setting('app.user_id')::uuid
    );
`;

const FIXTURE = `
  INSERT INTO documents (title, owner_id, tenant_id) VALUES
    ('t-doc-1', '${MANAGER_T}', '${TENANT_T}'),
    ('t-doc-2', '${MANAGER_T}', '${TENANT_T}'),
    ('t-doc-3', '${ADMIN_T}',   '${TENANT_T}'),
    ('u-doc-1', '${ADMIN_U}',   '${TENANT_U}');
`;

async function createDb(policiesSql: string): Promise<PGlite> {
  const db = new PGlite();
  await db.query("SELECT 1");
  await db.exec(`
    CREATE TABLE documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      owner_id uuid NOT NULL,
      tenant_id uuid NOT NULL
    );
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT ON documents TO app_user;
    ${FIXTURE}
    ${policiesSql}
  `);
  return db;
}

async function selectAs(
  db: PGlite,
  session: { roles: string[]; userId: string; tenantId: string },
): Promise<string[]> {
  await db.exec("RESET ROLE");
  await db.query(
    `SELECT
       set_config('app.roles', $1, false),
       set_config('app.user_id', $2, false),
       set_config('app.tenant_id', $3, false)`,
    [JSON.stringify(session.roles), session.userId, session.tenantId],
  );
  await db.exec("SET ROLE app_user");
  try {
    const result = await db.query<{ title: string }>("SELECT title FROM documents ORDER BY title");
    return result.rows.map((row) => row.title);
  } finally {
    await db.exec("RESET ROLE");
  }
}

describe("A13 — PGlite boots", () => {
  it("boots in Node and runs SELECT 1", async () => {
    const started = performance.now();
    const db = new PGlite();
    const result = await db.query<{ one: number }>("SELECT 1 AS one");
    const elapsedMs = performance.now() - started;
    expect(result.rows).toEqual([{ one: 1 }]);
    const guc = await db.query<{ value: string | null }>(
      "SELECT current_setting('app.roles', true) AS value",
    );
    // A brand-new session really is unset, so 'current_setting(..., true)::jsonb'
    // in a policy is NULL (and therefore false), not an error.
    expect(guc.rows[0].value).toBeNull();
    console.log(`[A13] PGlite cold boot + SELECT 1: ${elapsedMs.toFixed(0)} ms`);
    await db.close();
  }, 30_000);
});

describe("A14 — RLS filters rows via current_setting('app.roles')", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createDb(SPEC_POLICIES);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("table owner (superuser) bypasses RLS — why the test SET ROLEs to app_user", async () => {
    const result = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM documents");
    expect(result.rows[0].count).toBe(4);
  });

  it("non-admin (manager) sees rows allowed by the spec policies", async () => {
    const seen = await selectAs(db, { roles: ["manager"], userId: MANAGER_T, tenantId: TENANT_T });
    // Spec table says "only their 3 docs"; with verbatim permissive policies the
    // tenant policy ORs in every tenant-T row, so all 3 tenant-T docs are visible.
    expect(seen).toEqual(["t-doc-1", "t-doc-2", "t-doc-3"]);
    console.log("[A14] spec-verbatim manager sees:", seen);
  });

  it("admin sees every row because the admin clause is OR-ed with tenant isolation", async () => {
    const seen = await selectAs(db, { roles: ["admin"], userId: ADMIN_T, tenantId: TENANT_T });
    // Spec table expects tenant-scoped admins; OR semantics leak across tenants.
    expect(seen).toEqual(["t-doc-1", "t-doc-2", "t-doc-3", "u-doc-1"]);
    console.log("[A14] spec-verbatim admin sees:", seen);
  });

  it("role GUC actually gates rows: no roles => only owner rows", async () => {
    const seen = await selectAs(db, { roles: [], userId: MANAGER_T, tenantId: TENANT_T });
    expect(seen).toEqual(["t-doc-1", "t-doc-2", "t-doc-3"]);
  });

  it("documents RESET semantics: a reset custom GUC becomes '' (not NULL)", async () => {
    await db.exec("RESET app.roles");
    const result = await db.query<{ value: string | null }>(
      "SELECT current_setting('app.roles', true) AS value",
    );
    expect(result.rows[0].value).toBe("");
  });

  it("empty-string app.roles would break a naive ::jsonb cast (use nullif in policies)", async () => {
    await db.exec("RESET app.roles");
    await expect(
      db.query("SELECT current_setting('app.roles', true)::jsonb"),
    ).rejects.toThrow(/invalid input syntax for type json/);
    const safe = await db.query<{ ok: boolean }>(
      "SELECT (nullif(current_setting('app.roles', true), '')::jsonb ? 'admin') IS NOT TRUE AS ok",
    );
    expect(safe.rows[0].ok).toBe(true);
  });
});

describe("A14 — RESTRICTIVE tenant policy matches SPEC §8.4.5 result table", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createDb(RESTRICTIVE_POLICIES);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("admin (tenant T) sees all 3 documents in tenant T", async () => {
    const seen = await selectAs(db, { roles: ["admin"], userId: ADMIN_T, tenantId: TENANT_T });
    expect(seen).toEqual(["t-doc-1", "t-doc-2", "t-doc-3"]);
  });

  it("admin (tenant U) sees only the tenant-U document", async () => {
    const seen = await selectAs(db, { roles: ["admin"], userId: ADMIN_U, tenantId: TENANT_U });
    expect(seen).toEqual(["u-doc-1"]);
  });

  it("manager (tenant T) sees only their own 2 documents", async () => {
    const seen = await selectAs(db, { roles: ["manager"], userId: MANAGER_T, tenantId: TENANT_T });
    expect(seen).toEqual(["t-doc-1", "t-doc-2"]);
  });

  it("user (tenant T) with no ownership sees zero documents", async () => {
    const seen = await selectAs(db, {
      roles: ["user"],
      userId: "44444444-4444-4444-4444-444444444444",
      tenantId: TENANT_T,
    });
    expect(seen).toEqual([]);
  });
});