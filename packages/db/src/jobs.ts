// The persisted job queue (D-107, docs/JOBS.md §8).
//
// The queue is framework state, not application data: it is tenant-scoped so the structural
// invariant holds (`pgPolicy` + `ENABLE ROW LEVEL SECURITY`), the project re-exports the
// table from `db/schema.ts`, and the framework owns its DDL via a Drizzle migration. The
// engine's own writes run as the app role under the deployment tenant; a job *body* runs as
// the system role in its own audited transaction.
import { sql } from "drizzle-orm";
import { integer, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { tenantIsolationPolicy } from "./rls.ts";
import { tenantColumn } from "./tenant-column.ts";

/** Every `facilis_jobs.status` value, in lifecycle order. */
export const FACILIS_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type FacilisJobStatus = (typeof FACILIS_JOB_STATUSES)[number];

/**
 * One job instance. `input`/`output` are JSONB because the job contract is serialized
 * data (docs/JOBS.md §5); `status` is text rather than a Postgres enum so a new status is a
 * code change, not a migration.
 */
export const facilisJobs = pgTable(
  "facilis_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    /** When the job becomes eligible (a future instant means "scheduled"). */
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    tenantId: tenantColumn(),
  },
  () => [
    tenantIsolationPolicy(),
    // RLS is tenant-only (D-008); the queue is additionally gated by app permissions, so a
    // route that touches facilis_jobs without jobs:read/jobs:exec fails at the database, not
    // only in its own wrapper check. The framework engine's scope passes both permissions
    // explicitly (db-store); a request scope carries the session's expanded permissions.
    pgPolicy("facilis_jobs_read", {
      for: "select",
      using: sql`nullif(current_setting('app.permissions', true), '')::jsonb ? 'jobs:read'`,
    }),
    pgPolicy("facilis_jobs_insert", {
      for: "insert",
      withCheck: sql`nullif(current_setting('app.permissions', true), '')::jsonb ? 'jobs:exec'`,
    }),
    pgPolicy("facilis_jobs_update", {
      for: "update",
      using: sql`nullif(current_setting('app.permissions', true), '')::jsonb ? 'jobs:exec'`,
      withCheck: sql`nullif(current_setting('app.permissions', true), '')::jsonb ? 'jobs:exec'`,
    }),
    pgPolicy("facilis_jobs_delete", {
      for: "delete",
      using: sql`nullif(current_setting('app.permissions', true), '')::jsonb ? 'jobs:exec'`,
    }),
  ],
).enableRLS();

export type FacilisJobRow = typeof facilisJobs.$inferSelect;
export type NewFacilisJobRow = typeof facilisJobs.$inferInsert;
