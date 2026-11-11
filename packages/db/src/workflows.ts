// The workflow table (D-135, docs/WORKFLOWS.md §5).
//
// A workflow is framework state, not application data: tenant-scoped so the structural
// invariant holds (pgPolicy + ENABLE ROW LEVEL SECURITY), re-exported by the project's
// db/schema.ts, and DDL-owned by a Drizzle migration like the job queue (D-107).
//
// The chain itself is data: the runner advances rows with short compare-and-set writes and a
// manual step waits on a facilis_tasks row, so no job body ever holds a transaction open.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantIsolationPolicy } from "./rls.ts";
import { tenantColumn } from "./tenant-column.ts";

/** Every facilis_workflows.status value, in lifecycle order. */
export const FACILIS_WORKFLOW_STATUSES = [
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type FacilisWorkflowStatus = (typeof FACILIS_WORKFLOW_STATUSES)[number];

/**
 * One workflow instance. Statuses stay text (a new state is a code change, not a migration),
 * progress holds completed-step entries, plan the step identities captured at start so a
 * resume after a definition edit fails with workflow_definition_changed instead of guessing.
 */
export const facilisWorkflows = pgTable(
  "facilis_workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    input: jsonb("input").notNull(),
    progress: jsonb("progress").notNull().default([]),
    plan: jsonb("plan").notNull().default([]),
    currentStep: integer("current_step").notNull().default(0),
    currentJobId: uuid("current_job_id"),
    waitingTaskId: uuid("waiting_task_id"),
    attempts: integer("attempts").notNull().default(0),
    output: jsonb("output"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    tenantId: tenantColumn(),
  },
  (table) => [
    tenantIsolationPolicy(),
    // A RESTRICTIVE policy only narrows what a permissive policy already allows; with no
    // permissive policy Postgres denies every row (D-008). The runner's writes run as
    // facilis_app, so the scoped tenant needs this gate - exactly like facilis_jobs.
    pgPolicy("facilis_workflows_tenant_access", {
      for: "all",
      using: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
      withCheck: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
    }),
    index("facilis_workflows_status_created_idx").on(table.status, table.createdAt),
    index("facilis_workflows_name_idx").on(table.name),
  ],
).enableRLS();

export type FacilisWorkflowRow = typeof facilisWorkflows.$inferSelect;
export type NewFacilisWorkflowRow = typeof facilisWorkflows.$inferInsert;
