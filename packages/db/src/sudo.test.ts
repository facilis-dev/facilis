import { sql } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createDb, type FacilisDb } from "./client.ts";
import { applyStatements } from "./migrator.ts";
import { ensureAppRole, runWithPolicyScope } from "./policy.ts";
import { ensureSystemRole, runAsSystem, runWithSystemRole } from "./sudo.ts";
import {
  resetSudoAuditSink,
  setSudoAuditSink,
  SudoAuditUnavailableError,
  type SudoAuditEvent,
} from "./sudo-audit.ts";
import { TableAccessError } from "./table-guard.ts";

const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
});

const OWNER_A = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "22222222-2222-2222-2222-222222222222";

const IDENTITY_SQL = "select current_user as role, current_setting('app.sudo_id', true) as sudo_id";

let db: FacilisDb;
let audit: SudoAuditEvent[];

function captureAudit(): void {
  audit = [];
  setSudoAuditSink((event) => audit.push(event));
}

async function countRows(where = ""): Promise<number> {
  const result = await db.db.execute(
    sql.raw("select count(*)::int as count from documents" + where),
  );
  return Number(result.rows[0]?.["count"]);
}

describe("audited sudo", () => {
  beforeAll(async () => {
    db = await createDb();
    await applyStatements(db, [
      "CREATE TABLE documents (id text PRIMARY KEY, owner_id text NOT NULL)",
      "ALTER TABLE documents ENABLE ROW LEVEL SECURITY",
      "CREATE POLICY owner_isolation ON documents FOR ALL USING " +
        "(owner_id = nullif(current_setting('app.user_id', true), ''))",
      `INSERT INTO documents (id, owner_id) VALUES ('a-1', '${OWNER_A}'), ('b-1', '${OWNER_B}')`,
    ]);
    await ensureAppRole(db);
    await ensureSystemRole(db);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  afterEach(() => {
    resetSudoAuditSink();
  });

  it("provisions facilis_system as NOLOGIN NOSUPERUSER BYPASSRLS, member of facilis_app", async () => {
    const roles = await db.db.execute(
      sql.raw(
        "select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles " +
          "where rolname in ('facilis_app', 'facilis_system') order by rolname",
      ),
    );
    expect(roles.rows).toEqual([
      { rolname: "facilis_app", rolsuper: false, rolbypassrls: false, rolcanlogin: false },
      { rolname: "facilis_system", rolsuper: false, rolbypassrls: true, rolcanlogin: false },
    ]);

    const membership = await db.db.execute(
      sql.raw(
        "select 1 from pg_auth_members m " +
          "join pg_roles granted on granted.oid = m.roleid " +
          "join pg_roles member on member.oid = m.member " +
          "where granted.rolname = 'facilis_system' and member.rolname = 'facilis_app'",
      ),
    );
    expect(membership.rows).toHaveLength(1);
  });

  it("is idempotent and re-asserts the role attributes", async () => {
    await ensureSystemRole(db);
    await ensureSystemRole(db);

    const result = await db.db.execute(
      sql.raw(
        "select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'facilis_system'",
      ),
    );
    expect(result.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: true,
      rolcanlogin: false,
    });
  });

  it("bypasses RLS inside the block, restores facilis_app and persists the writes", async () => {
    const observed = await runWithPolicyScope(
      db,
      { userId: OWNER_A, permissions: [] },
      async (tx) => {
        const before = await tx.execute(sql.raw("select id from documents order by id"));
        const elevated = await runWithSystemRole(
          tx,
          { sudoId: "sudo-elevated" },
          async (systemDb) => {
            const rows = await systemDb.execute(sql.raw("select id from documents order by id"));
            const identity = await systemDb.execute(sql.raw(IDENTITY_SQL));
            await systemDb.execute(
              sql.raw(`insert into documents (id, owner_id) values ('c-1', '${OWNER_B}')`),
            );
            return { rows: rows.rows, identity: identity.rows[0] };
          },
        );
        const afterIdentity = await tx.execute(sql.raw(IDENTITY_SQL));
        const after = await tx.execute(sql.raw("select id from documents order by id"));
        return {
          before: before.rows,
          elevated,
          afterIdentity: afterIdentity.rows[0],
          after: after.rows,
        };
      },
    );

    expect(observed.before).toEqual([{ id: "a-1" }]);
    // BYPASSRLS: the system identity sees both owners' rows.
    expect(observed.elevated.rows).toEqual([{ id: "a-1" }, { id: "b-1" }]);
    expect(observed.elevated.identity).toEqual({
      role: "facilis_system",
      sudo_id: "sudo-elevated",
    });
    // Restored explicitly: an unscoped read is filtered again, and the GUC is cleared.
    expect(observed.afterIdentity).toEqual({ role: "facilis_app", sudo_id: "" });
    expect(observed.after).toEqual([{ id: "a-1" }]);
    await expect(countRows(" where id = 'c-1'")).resolves.toBe(1);
  });

  it("rolls the block back and restores the role when the callback throws", async () => {
    await runWithPolicyScope(db, { userId: OWNER_A, permissions: [] }, async (tx) => {
      await expect(
        runWithSystemRole(tx, { sudoId: "sudo-failing" }, async (systemDb) => {
          await systemDb.execute(
            sql.raw(`insert into documents (id, owner_id) values ('d-rollback', '${OWNER_A}')`),
          );
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      const identity = await tx.execute(sql.raw(IDENTITY_SQL));
      expect(identity.rows[0]).toEqual({ role: "facilis_app", sudo_id: "" });
    });
    await expect(countRows(" where id = 'd-rollback'")).resolves.toBe(0);
  });

  it("runAsSystem runs in its own transaction, audits started/succeeded and returns the result", async () => {
    captureAudit();
    const result = await runAsSystem(
      db,
      {
        actor: "system:nightly",
        operation: "documents:archive",
        reason: "nightly archive job",
        dbTables: ["documents"],
        rawSql: true,
        requestId: "job-1",
      },
      async (systemDb) => {
        const inserted = await systemDb.execute(
          sql.raw(
            `insert into documents (id, owner_id) values ('e-job', '${OWNER_A}') returning id`,
          ),
        );
        return inserted.rows[0];
      },
    );

    expect(result).toEqual({ id: "e-job" });
    expect(audit.map((entry) => entry.event)).toEqual(["started", "succeeded"]);
    const [started, succeeded] = audit;
    expect(started).toMatchObject({
      id: expect.any(String),
      at: expect.any(String),
      actor: "system:nightly",
      roles: [],
      operation: "documents:archive",
      reason: "nightly archive job",
      tables: ["documents"],
      requestId: "job-1",
    });
    expect(started?.actorUserId).toBeUndefined();
    expect(started?.sessionHash).toBeUndefined();
    expect(succeeded).toMatchObject({
      id: started?.id,
      event: "succeeded",
      outcome: "succeeded",
      // Raw SQL is uninspectable: the declaration is authoritative and the audit says so.
      observedTables: [],
      durationMs: expect.any(Number),
    });
    await expect(countRows(" where id = 'e-job'")).resolves.toBe(1);
  });

  it("runAsSystem audits failed and rolls back when the callback throws", async () => {
    captureAudit();
    await expect(
      runAsSystem(
        db,
        {
          actor: "system:nightly",
          operation: "documents:import",
          reason: "import job",
          dbTables: ["documents"],
          rawSql: true,
        },
        async (systemDb) => {
          await systemDb.execute(
            sql.raw(`insert into documents (id, owner_id) values ('f-fail', '${OWNER_A}')`),
          );
          throw new Error("import failed");
        },
      ),
    ).rejects.toThrow("import failed");

    expect(audit.map((entry) => entry.event)).toEqual(["started", "failed"]);
    expect(audit[1]).toMatchObject({
      event: "failed",
      outcome: "failed",
      errorCode: "handler_failed",
      durationMs: expect.any(Number),
    });
    await expect(countRows(" where id = 'f-fail'")).resolves.toBe(0);
  });

  it("fails closed before escalating when the audit sink throws", async () => {
    setSudoAuditSink(() => {
      throw new Error("sink down");
    });
    const fn = vi.fn();

    await expect(
      runAsSystem(
        db,
        {
          actor: "system:nightly",
          operation: "documents:prune",
          reason: "prune",
          dbTables: ["documents"],
        },
        fn,
      ),
    ).rejects.toBeInstanceOf(SudoAuditUnavailableError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("accepts an empty dbTables list for a job that declares no relation (D-107)", async () => {
    captureAudit();
    const result = await runAsSystem(
      db,
      { actor: "system:nightly", operation: "documents:prune", reason: "prune", dbTables: [] },
      async () => "done",
    );

    expect(result).toBe("done");
    expect(audit.map((entry) => entry.event)).toEqual(["started", "succeeded"]);
    // The audit entry stays complete and explicitly says "no tables", never omits the field.
    expect(audit[0]).toMatchObject({ tables: [] });
    expect(audit[1]).toMatchObject({ tables: [], observedTables: [] });
  });

  it("rejects dbTables that are not non-empty strings and a non-boolean rawSql", async () => {
    captureAudit();
    const fn = vi.fn();
    const base = { actor: "system:nightly", operation: "documents:prune", reason: "prune" } as const;

    await expect(runAsSystem(db, { ...base, dbTables: [""] }, fn)).rejects.toThrow(
      /sudo_invalid_dbTables/,
    );
    await expect(
      runAsSystem(db, { ...base, dbTables: [], rawSql: "yes" as never }, fn),
    ).rejects.toThrow(/sudo_invalid_rawSql/);
    expect(fn).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("records the observed declared relation on the succeeded audit entry", async () => {
    captureAudit();
    const rows = await runAsSystem(
      db,
      {
        actor: "system:nightly",
        operation: "documents:list",
        reason: "list documents",
        dbTables: ["documents"],
      },
      async (systemDb) => systemDb.select().from(documents),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(audit.map((entry) => entry.event)).toEqual(["started", "succeeded"]);
    expect(audit[1]).toMatchObject({
      event: "succeeded",
      outcome: "succeeded",
      observedTables: ["documents"],
    });
  });

  it("fails closed on an undeclared relation and audits the stable code, never the name", async () => {
    captureAudit();
    const fn = vi.fn();

    await expect(
      runAsSystem(
        db,
        {
          actor: "system:nightly",
          operation: "purge",
          reason: "purge job",
          dbTables: [],
        },
        async (systemDb) => {
          fn();
          return systemDb.select().from(documents);
        },
      ),
    ).rejects.toBeInstanceOf(TableAccessError);

    // The callback DID run: the guard refuses the query, it does not pre-screen the body.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(audit.map((entry) => entry.event)).toEqual(["started", "failed"]);
    expect(audit[1]).toMatchObject({
      event: "failed",
      outcome: "failed",
      errorCode: "table_not_declared",
    });
    expect(JSON.stringify(audit)).not.toContain("documents");
  });

  it("refuses raw SQL unless the job declares rawSql: true", async () => {
    captureAudit();
    await expect(
      runAsSystem(
        db,
        {
          actor: "system:nightly",
          operation: "documents:count",
          reason: "count",
          dbTables: ["documents"],
        },
        async (systemDb) => systemDb.execute(sql.raw("select count(*)::int as count from documents")),
      ),
    ).rejects.toBeInstanceOf(TableAccessError);

    expect(audit.map((entry) => entry.event)).toEqual(["started", "failed"]);
    expect(audit[1]).toMatchObject({ errorCode: "raw_sql_not_allowed" });
  });
});
