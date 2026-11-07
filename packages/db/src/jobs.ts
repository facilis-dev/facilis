// The persisted job queue (D-102, docs/JOBS.md §8).
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
    // A RESTRICTIVE policy only narrows what a permissive policy already allows; with no
    // permissive policy Postgres denies every row (D-008). The queue reads/writes run as
    // facilis_app, so the scoped tenant needs this gate — exactly like auth users and
    // i18n_messages.
    pgPolicy("facilis_jobs_tenant_access", {
      for: "all",
      using: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
      withCheck: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
    }),
  ],
).enableRLS();

export type FacilisJobRow = typeof facilisJobs.$inferSelect;
export type NewFacilisJobRow = typeof facilisJobs.$inferInsert;
