import { sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyStatements } from "./migrator.ts";
import { ensureAppRole } from "./policy.ts";
import { ownerIsolationPolicy, policyCreateSql, tenantIsolationPolicy } from "./rls.ts";
import { ensureSystemRole, runWithSystemRole } from "./sudo.ts";
import { resetSudoAuditSink, setSudoAuditSink } from "./sudo-audit.ts";

const TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OWNER = "11111111-1111-1111-1111-111111111111";

const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
  },
  () => [tenantIsolationPolicy("tenant_id"), ownerIsolationPolicy("owner_id")],
).enableRLS();

const secrets = pgTable("secrets", {
  id: uuid("id").primaryKey(),
  label: text("label").notNull(),
});

/**
 * D-136 production shape: the pool connects as **facilis_app** (D-068), not as the superuser
 * the other suites use. The app role is `NOINHERIT` but a member of `facilis_system`, so the
 * boundary must hold on the direct connection and `SET LOCAL ROLE` must still elevate.
 * PGlite only has the bootstrap superuser, so `SET SESSION AUTHORIZATION` simulates it.
 */
describe("production identity: the connection itself is facilis_app", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createDb();
    await applyStatements(db, [
      "CREATE TABLE documents (id uuid PRIMARY KEY, owner_id uuid NOT NULL, tenant_id uuid NOT NULL)",
      "ALTER TABLE documents ENABLE ROW LEVEL SECURITY",
      ...getDocumentsPolicies(),
      "CREATE TABLE secrets (id uuid PRIMARY KEY, label text NOT NULL)",
      `INSERT INTO documents (id, owner_id, tenant_id) VALUES
         ('aaaaaaaa-0000-0000-0000-000000000001', '${OWNER}', '${TENANT}')`,
      "INSERT INTO secrets (id, label) VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'raw')",
    ]);
    await ensureAppRole(db);
    await ensureSystemRole(db);
    setSudoAuditSink(() => {});
  }, 30_000);

  afterAll(async () => {
    // Restore the authenticated superuser even if a test left the session identity changed.
    await db.db.execute(sql.raw("RESET SESSION AUTHORIZATION"));
    resetSudoAuditSink();
    await db.close();
  });

  it("keeps the boundary and still elevates through the audited SET ROLE", async () => {
    const result = await db.db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL SESSION AUTHORIZATION facilis_app"));
      const identity = await tx.execute(
        sql.raw("select current_user as role, session_user as session"),
      );
      await tx.execute(
        sql.raw(
          `select set_config('app.tenant_id', '${TENANT}', true), set_config('app.user_id', '${OWNER}', true)`,
        ),
      );
      const visible = await tx.select({ id: documents.id }).from(documents);
      const elevated = await runWithSystemRole(tx, { sudoId: "production-identity" }, (systemDb) =>
        systemDb.select({ id: secrets.id }).from(secrets),
      );
      const after = await tx.execute(sql.raw("select current_user as role"));
      return { identity: identity.rows[0], visible, elevated, after: after.rows[0] };
    });
    expect(result.identity).toEqual({ role: "facilis_app", session: "facilis_app" });
    expect(result.visible).toHaveLength(1);
    expect(result.elevated).toHaveLength(1);
    expect(result.after).toEqual({ role: "facilis_app" });
  });

  it("denies the system-only table on the direct connection", async () => {
    const denied = await db.db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL SESSION AUTHORIZATION facilis_app"));
      await tx.execute(sql.raw("savepoint denied"));
      try {
        await tx.select().from(secrets);
        return null;
      } catch (error) {
        // The savepoint keeps the transaction usable so the test can finish cleanly.
        await tx.execute(sql.raw("rollback to savepoint denied"));
        return error;
      }
    });
    expect(denied).not.toBeNull();
    const messages: string[] = [];
    let current: unknown = denied;
    for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
      messages.push(current.message);
      current = current.cause;
    }
    expect(messages.join(" | ")).toMatch(/permission denied/i);
  });
});

/** The policy SQL the drizzle table declares, rendered exactly as the migration would. */
function getDocumentsPolicies(): string[] {
  return [
    policyCreateSql("documents", tenantIsolationPolicy("tenant_id")),
    policyCreateSql("documents", ownerIsolationPolicy("owner_id")),
  ];
}
