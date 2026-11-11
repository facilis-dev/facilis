import { pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { JobDefinition } from "@facilis/core";
import {
  applyStatements,
  createDb,
  ensureAppRole,
  ensureSystemRole,
  resetSudoAuditSink,
  runWithPolicyScope,
  setSudoAuditSink,
  TableAccessError,
  type FacilisDb,
  type PolicyScopedDatabase,
  type SudoAuditEvent,
} from "@facilis/db";

import type { StoredJob } from "./contracts.ts";
import { createSystemJobExecutor } from "./executor.ts";

interface TestRunContext {
  readonly jobId: string;
  readonly name: string;
  readonly attempt: number;
  readonly data: unknown;
  readonly signal: AbortSignal;
  readonly db: PolicyScopedDatabase;
}

const schema = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };

const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
});

interface DefinitionOptions {
  readonly dbTables?: readonly string[];
  readonly rawSql?: boolean;
}

/**
 * The executor contract only calls `run`; the engine owns input/output validation (covered
 * by its own suite), so a structural definition keeps zod out of this package's tests.
 */
function jobDefinition(
  name: string,
  run: (ctx: TestRunContext) => Promise<unknown>,
  options: DefinitionOptions = {},
): JobDefinition<unknown, unknown> {
  return {
    name,
    input: schema,
    output: schema,
    dbTables: options.dbTables ?? [],
    ...(options.rawSql === true ? { rawSql: true } : {}),
    run,
  } as unknown as JobDefinition<unknown, unknown>;
}

function storedJob(name: string, attempts = 1): StoredJob {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name,
    status: "running",
    input: {},
    output: null,
    error: null,
    attempts,
    maxAttempts: 1,
    timeoutMs: 30_000,
    runAt: new Date("2026-11-07T10:00:00.000Z"),
    createdAt: new Date("2026-11-07T09:59:00.000Z"),
    startedAt: new Date("2026-11-07T10:00:00.000Z"),
    finishedAt: null,
  };
}

describe("createSystemJobExecutor", () => {
  let db: FacilisDb;
  let audit: SudoAuditEvent[];

  beforeAll(async () => {
    db = await createDb();
    await applyStatements(db, [
      "CREATE TABLE documents (id text PRIMARY KEY, title text NOT NULL)",
      // RLS with no policy: facilis_app sees nothing, facilis_system (BYPASSRLS) sees the row.
      "ALTER TABLE documents ENABLE ROW LEVEL SECURITY",
      "INSERT INTO documents (id, title) VALUES ('doc-1', 'secret')",
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

  function captureAudit(): void {
    audit = [];
    setSudoAuditSink((event) => audit.push(event));
  }

  it("sees RLS-hidden rows through the system context and audits the job identity", async () => {
    captureAudit();
    const definition = jobDefinition(
      "read-documents",
      async ({ db: systemDb }) => {
        const rows = await systemDb.execute("select id, title from documents order by id");
        const identity = await systemDb.execute("select current_user as role");
        return { rows: rows.rows, role: identity.rows[0] };
      },
      { dbTables: ["documents"], rawSql: true },
    );

    const result = await createSystemJobExecutor(db)({
      definition,
      data: {},
      job: storedJob("read-documents"),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      rows: [{ id: "doc-1", title: "secret" }],
      role: { role: "facilis_system" },
    });

    // The same read as the app role is filtered: the escalation is what makes it visible.
    const hidden = await runWithPolicyScope(db, {}, async (tx) => {
      const count = await tx.execute("select count(*)::int as count from documents");
      return count.rows[0];
    });
    expect(hidden).toEqual({ count: 0 });

    expect(audit.map((entry) => entry.event)).toEqual(["started", "succeeded"]);
    expect(audit[0]).toMatchObject({
      actor: "system:job:read-documents",
      roles: [],
      operation: "jobs:read-documents",
      reason: expect.stringContaining('Background job "read-documents" (attempt 1)'),
      tables: ["documents"],
    });
    expect(audit[1]).toMatchObject({ event: "succeeded", outcome: "succeeded" });
  });

  it("accepts a job that declares no audit tables and forwards attempt/signal", async () => {
    captureAudit();
    const aborter = new AbortController();
    const observed: Array<{ attempt: number; jobId: string; sameSignal: boolean }> = [];
    const job = storedJob("append-log", 2);
    const definition = jobDefinition(
      "append-log",
      async ({ db: systemDb, attempt, jobId, signal }) => {
        await systemDb.execute(
          "insert into documents (id, title) values ('doc-2', 'written') returning id",
        );
        observed.push({ attempt, jobId, sameSignal: signal === aborter.signal });
        return { ok: true };
      },
      { rawSql: true },
    );

    await expect(
      createSystemJobExecutor(db)({ definition, data: {}, job, signal: aborter.signal }),
    ).resolves.toEqual({ ok: true });
    expect(observed).toEqual([{ attempt: 2, jobId: job.id, sameSignal: true }]);

    // A job may declare no relations (unlike a route's sudo) and pair that with the rawSql
    // exception: raw SQL is uninspectable, so the entry records the empty declaration.
    expect(audit[0]).toMatchObject({ tables: [] });
    const persisted = await db.db.execute("select title from documents where id = 'doc-2'");
    expect(persisted.rows).toEqual([{ title: "written" }]);
  });

  it("audits failed and rolls the job transaction back when the body throws", async () => {
    captureAudit();
    const definition = jobDefinition(
      "failing",
      async ({ db: systemDb }) => {
        await systemDb.execute("insert into documents (id, title) values ('doc-3', 'rolled-back')");
        throw new Error("boom");
      },
      { dbTables: ["documents"], rawSql: true },
    );

    await expect(
      createSystemJobExecutor(db)({
        definition,
        data: {},
        job: storedJob("failing"),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("boom");

    expect(audit.map((entry) => entry.event)).toEqual(["started", "failed"]);
    expect(audit[1]).toMatchObject({
      event: "failed",
      outcome: "failed",
      errorCode: "handler_failed",
    });
    const rolledBack = await db.db.execute("select id from documents where id = 'doc-3'");
    expect(rolledBack.rows).toEqual([]);
  });

  it("records the observed declared relation on success", async () => {
    captureAudit();
    const definition = jobDefinition(
      "list-documents",
      async ({ db: systemDb }) => {
        const rows = await systemDb.select().from(documents);
        return { count: rows.length };
      },
      { dbTables: ["documents"] },
    );

    const result = await createSystemJobExecutor(db)({
      definition,
      data: {},
      job: storedJob("list-documents"),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ count: expect.any(Number) });
    expect(audit.map((entry) => entry.event)).toEqual(["started", "succeeded"]);
    expect(audit[1]).toMatchObject({
      event: "succeeded",
      outcome: "succeeded",
      observedTables: ["documents"],
    });
  });

  it("fails closed on an undeclared relation and audits the stable code, never the name", async () => {
    captureAudit();
    const definition = jobDefinition("purge", async ({ db: systemDb }) =>
      systemDb.select().from(documents),
    );

    await expect(
      createSystemJobExecutor(db)({
        definition,
        data: {},
        job: storedJob("purge"),
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(TableAccessError);

    expect(audit.map((entry) => entry.event)).toEqual(["started", "failed"]);
    expect(audit[1]).toMatchObject({
      event: "failed",
      outcome: "failed",
      errorCode: "table_not_declared",
    });
    expect(JSON.stringify(audit)).not.toContain("documents");
  });

  it("refuses raw SQL unless the definition declares the rawSql exception", async () => {
    captureAudit();
    const denied = jobDefinition(
      "count-denied",
      async ({ db: systemDb }) => systemDb.execute("select count(*)::int as count from documents"),
      { dbTables: ["documents"] },
    );

    await expect(
      createSystemJobExecutor(db)({
        definition: denied,
        data: {},
        job: storedJob("count-denied"),
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(TableAccessError);
    expect(audit[1]).toMatchObject({ event: "failed", errorCode: "raw_sql_not_allowed" });

    captureAudit();
    const allowed = jobDefinition(
      "count-allowed",
      async ({ db: systemDb }) => {
        const result = await systemDb.execute("select count(*)::int as count from documents");
        return result.rows[0];
      },
      { dbTables: ["documents"], rawSql: true },
    );

    await expect(
      createSystemJobExecutor(db)({
        definition: allowed,
        data: {},
        job: storedJob("count-allowed"),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ count: expect.any(Number) });
    expect(audit[1]).toMatchObject({ event: "succeeded", observedTables: [] });
  });
});
