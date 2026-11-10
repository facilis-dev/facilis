import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyStatements, MIGRATION_TRACKING_TABLE } from "./migrator.ts";
import { ensureAppRole, runWithPolicyScope } from "./policy.ts";
import { ownerIsolationPolicy, policyCreateSql, tenantIsolationPolicy } from "./rls.ts";
import { ensureSystemRole, runWithSystemRole } from "./sudo.ts";
import { resetSudoAuditSink, setSudoAuditSink } from "./sudo-audit.ts";

const TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OWNER = "11111111-1111-1111-1111-111111111111";

// The scoped table: RLS is its grant, and its policies decide the rows.
const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
  },
  () => [tenantIsolationPolicy("tenant_id"), ownerIsolationPolicy("owner_id")],
).enableRLS();

// The system-only table: no RLS, so the app role must hold no privilege on it (D-136).
const scratch = pgTable("scratch", {
  id: uuid("id").primaryKey(),
  label: text("label").notNull(),
});

describe("RLS is the app-role grant boundary", () => {
  let db: FacilisDb;
  let systemOnlyTables: readonly string[];

  beforeAll(async () => {
    db = await createDb();
    await applyStatements(db, [
      "CREATE TABLE documents (id uuid PRIMARY KEY, owner_id uuid NOT NULL, tenant_id uuid NOT NULL)",
      "ALTER TABLE documents ENABLE ROW LEVEL SECURITY",
      ...getDocumentsPolicies(),
      "CREATE TABLE scratch (id uuid PRIMARY KEY, label text NOT NULL)",
      `INSERT INTO documents (id, owner_id, tenant_id) VALUES
         ('aaaaaaaa-0000-0000-0000-000000000001', '${OWNER}', '${TENANT}')`,
      "INSERT INTO scratch (id, label) VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'raw')",
    ]);
    ({ systemOnlyTables } = await ensureAppRole(db));
    await ensureSystemRole(db);
    // The audit sink is exercised by sudo.test.ts; keep this suite quiet.
    setSudoAuditSink(() => {});
  }, 30_000);

  afterAll(async () => {
    resetSudoAuditSink();
    await db.close();
  });

  it("provisions the app role NOINHERIT so the sudo membership hands it no grants", async () => {
    const role = await db.db.execute(
      sql.raw("select rolinherit from pg_roles where rolname = 'facilis_app'"),
    );
    expect(role.rows[0]).toEqual({ rolinherit: false });
  });

  it("reports the tables that only the system identity can reach", () => {
    expect(systemOnlyTables).toEqual(expect.arrayContaining(["scratch", MIGRATION_TRACKING_TABLE]));
    expect(systemOnlyTables).not.toContain("documents");
  });

  it("grants the app role DML on a table with RLS", async () => {
    const grants = await db.db.execute(
      sql.raw(
        "select has_table_privilege('facilis_app', 'documents', 'SELECT') as sel, " +
          "has_table_privilege('facilis_app', 'documents', 'INSERT') as ins",
      ),
    );
    expect(grants.rows[0]).toEqual({ sel: true, ins: true });
    const visible = await runWithPolicyScope(db, { tenantId: TENANT, userId: OWNER }, (tx) =>
      tx.select({ id: documents.id }).from(documents),
    );
    expect(visible).toHaveLength(1);
  });

  it("denies the app role every privilege on a table without RLS", async () => {
    await expectPermissionDenied(
      runWithPolicyScope(db, { tenantId: TENANT }, (tx) => tx.select().from(scratch)),
    );
    await expectPermissionDenied(
      runWithPolicyScope(db, { tenantId: TENANT }, (tx) =>
        tx.insert(scratch).values({ id: randomUUID(), label: "nope" }),
      ),
    );
  });

  it("keeps the system role and the privileged root client able to use it", async () => {
    const viaRoot = await db.db.select({ label: scratch.label }).from(scratch);
    expect(viaRoot).toEqual([{ label: "raw" }]);
    const viaSystem = await db.db.transaction((tx) =>
      runWithSystemRole(tx, { sudoId: "policy-test" }, async (systemDb) => {
        const rows = await systemDb.select({ label: scratch.label }).from(scratch);
        await systemDb.insert(scratch).values({ id: randomUUID(), label: "system" });
        return rows;
      }),
    );
    expect(viaSystem).toEqual([{ label: "raw" }]);
  });

  it("re-asserts the boundary: a leaked grant is revoked on the next run", async () => {
    await db.db.execute(sql.raw("grant select on scratch to facilis_app"));
    const leaked = await runWithPolicyScope(db, { tenantId: TENANT }, (tx) =>
      tx.select({ id: scratch.id, label: scratch.label }).from(scratch),
    );
    expect(leaked.length).toBeGreaterThan(0);
    await ensureAppRole(db);
    await expectPermissionDenied(
      runWithPolicyScope(db, { tenantId: TENANT }, (tx) => tx.select().from(scratch)),
    );
  });

  it("keeps the membership that production needs for the audited SET ROLE", async () => {
    const membership = await db.db.execute(
      sql.raw("select pg_has_role('facilis_app', 'facilis_system', 'MEMBER') as member"),
    );
    expect(membership.rows[0]).toEqual({ member: true });
  });

  it("lets a request elevate from the app role to the system role (the sudo path)", async () => {
    const rows = await runWithPolicyScope(db, { tenantId: TENANT }, (tx) =>
      runWithSystemRole(tx, { sudoId: "app-to-system" }, (systemDb) =>
        systemDb.select({ id: scratch.id }).from(scratch),
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("leaves a table created after provisioning closed until it enables RLS", async () => {
    await db.db.execute(
      sql.raw("CREATE TABLE later_notes (id uuid PRIMARY KEY, label text NOT NULL)"),
    );
    await expectPermissionDenied(
      runWithPolicyScope(db, { tenantId: TENANT }, (tx) =>
        tx.execute(sql.raw("select * from later_notes")),
      ),
    );
  });
});

/**
 * Drizzle wraps a pg error ("Failed query: …"), so the cause chain is where the privilege
 * message lives; unwrap it instead of matching the wrapper's text.
 */
async function expectPermissionDenied(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).not.toBeNull();
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.join(" | ")).toMatch(/permission denied/i);
}

/** The policy SQL the drizzle table declares, rendered exactly as the migration would. */
function getDocumentsPolicies(): string[] {
  return [
    policyCreateSql("documents", tenantIsolationPolicy("tenant_id")),
    policyCreateSql("documents", ownerIsolationPolicy("owner_id")),
  ];
}
