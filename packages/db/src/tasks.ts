// The manual-task table (D-135, docs/WORKFLOWS.md §5).
//
// A task is framework state, not application data: tenant-scoped so the structural invariant
// holds (pgPolicy + ENABLE ROW LEVEL SECURITY), re-exported by the project's db/schema.ts, and
// DDL-owned by a Drizzle migration like the job queue (D-107).
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

/** Every facilis_tasks.status value, in lifecycle order. */
export const FACILIS_TASK_STATUSES = ["pending", "decided", "expired", "cancelled"] as const;

export type FacilisTaskStatus = (typeof FACILIS_TASK_STATUSES)[number];

/** What the task asks for; approvals are the only kind the v1 slice ships. */
export const FACILIS_TASK_KINDS = ["approval"] as const;

export type FacilisTaskKind = (typeof FACILIS_TASK_KINDS)[number];

/** How a decided task closes. */
export const FACILIS_TASK_DECISIONS = ["approve", "reject"] as const;

export type FacilisTaskDecision = (typeof FACILIS_TASK_DECISIONS)[number];

/**
 * One manual task. Statuses stay text (a new state is a code change, not a migration) and the
 * workflow columns are nullable so a task can exist standalone before the workflow layer lands
 * (D-135 W1).
 */
export const facilisTasks = pgTable(
  "facilis_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id"),
    stepIndex: integer("step_index"),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    decision: text("decision"),
    titleKey: text("title_key").notNull(),
    titleParams: jsonb("title_params").notNull().default({}),
    payload: jsonb("payload"),
    requestedBy: text("requested_by"),
    assignedPermission: text("assigned_permission"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    tenantId: tenantColumn(),
  },
  (table) => [
    tenantIsolationPolicy(),
    // A RESTRICTIVE policy only narrows what a permissive policy already allows; with no
    // permissive policy Postgres denies every row (D-008). The queue's reads/writes run as
    // facilis_app, so the scoped tenant needs this gate — exactly like facilis_jobs.
    pgPolicy("facilis_tasks_tenant_access", {
      for: "all",
      using: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
      withCheck: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
    }),
    index("facilis_tasks_status_created_idx").on(table.status, table.createdAt),
    index("facilis_tasks_workflow_idx").on(table.workflowId),
    index("facilis_tasks_assigned_idx").on(table.assignedPermission, table.status),
  ],
).enableRLS();

export type FacilisTaskRow = typeof facilisTasks.$inferSelect;
export type NewFacilisTaskRow = typeof facilisTasks.$inferInsert;
