// Shared PGlite fixture for the persistent job-store suites (db-store.test.ts and
// db-store-recovery.test.ts). The suites are split to stay under the 300-line limit; each
// gets its own in-memory cluster, created from the real drizzle table definition so the
// store is exercised through the real policies and tenant-column default.
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import type { FacilisDb } from "@facilis.dev/db";
import {
  createDb,
  ensureAppRole,
  facilisJobs,
  policyCreateSql,
  tenantDefaultSql,
} from "@facilis.dev/db";

import type { NewStoredJob, StoredJob } from "./contracts.ts";
import { createDbJobStore } from "./db-store.ts";

/** Deployment tenant; a second tenant proves the RLS boundary cannot be crossed. */
export const TENANT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
export const OTHER_TENANT = "dddddddd-dddd-dddd-dddd-dddddddddddd";
export const BASE = new Date("2026-11-07T12:00:00.000Z");
export const FINISHED = new Date("2026-11-07T12:30:00.000Z");

export type JobsTestStore = ReturnType<typeof createDbJobStore>;

export interface JobsTestContext {
  readonly db: FacilisDb;
  readonly store: JobsTestStore;
}

export async function createJobsTestContext(): Promise<JobsTestContext> {
  const db = await createDb();
  const tenantDefault = new PgDialect().sqlToQuery(tenantDefaultSql()).sql;
  const statements = [
    `CREATE TABLE facilis_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      status text NOT NULL,
      input jsonb NOT NULL,
      output jsonb,
      error text,
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL,
      timeout_ms integer NOT NULL,
      run_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL DEFAULT ${tenantDefault}
    )`,
    "ALTER TABLE facilis_jobs ENABLE ROW LEVEL SECURITY",
    ...getTableConfig(facilisJobs).policies.map((policy) =>
      policyCreateSql("facilis_jobs", policy),
    ),
  ];
  await db.db.transaction(async (tx) => {
    // eslint-disable-next-line no-await-in-loop -- DDL must run in order on one connection.
    for (const statement of statements) await tx.execute(sql.raw(statement));
  });
  await ensureAppRole(db);
  return { db, store: createDbJobStore({ db, tenantId: TENANT_ID }) };
}

/** Empties the queue as the connecting superuser, so each test starts from a clean slate. */
export async function clearJobs(db: FacilisDb): Promise<void> {
  await db.db.execute(sql.raw("delete from facilis_jobs"));
}

let sequence = 0;

export function newJob(overrides: Partial<NewStoredJob> = {}): NewStoredJob {
  sequence += 1;
  return {
    id: randomUUID(),
    name: "purge",
    input: { olderThanDays: 7 },
    maxAttempts: 3,
    timeoutMs: 10_000,
    runAt: BASE,
    createdAt: new Date(BASE.getTime() + sequence),
    ...overrides,
  };
}

export async function insertAndClaim(
  store: JobsTestStore,
  job: NewStoredJob,
  now = BASE,
): Promise<StoredJob> {
  await store.insert(job);
  const [claimed] = await store.claim(now, 1);
  if (claimed === undefined) throw new Error("the job was not claimable");
  return claimed;
}
