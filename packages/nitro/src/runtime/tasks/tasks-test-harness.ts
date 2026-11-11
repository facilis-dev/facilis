// Shared PGlite fixture for the manual-task store suite (D-135). It creates the real
// drizzle table definition, its policies and the tenant-column default, so the store is
// exercised through the same RLS boundary the runtime uses in dev.
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import type { FacilisDb } from "@facilis.dev/db";
import {
  createDb,
  ensureAppRole,
  facilisTasks,
  policyCreateSql,
  tenantDefaultSql,
} from "@facilis.dev/db";

import type { NewStoredTask } from "./contracts.ts";
import { createDbTaskStore } from "./db-store.ts";

/** Deployment tenant; a second tenant proves the RLS boundary cannot be crossed. */
export const TENANT_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
export const OTHER_TENANT = "ffffffff-ffff-ffff-ffff-ffffffffffff";
export const BASE = new Date("2026-11-10T12:00:00.000Z");
export const LATER = new Date("2026-11-10T12:30:00.000Z");

export interface TasksTestContext {
  readonly db: FacilisDb;
  readonly store: ReturnType<typeof createDbTaskStore>;
}

export async function createTasksTestContext(): Promise<TasksTestContext> {
  const db = await createDb();
  const tenantDefault = new PgDialect().sqlToQuery(tenantDefaultSql()).sql;
  const statements = [
    `CREATE TABLE facilis_tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id uuid,
      step_index integer,
      kind text NOT NULL,
      status text NOT NULL,
      decision text,
      title_key text NOT NULL,
      title_params jsonb NOT NULL DEFAULT '{}'::jsonb,
      payload jsonb,
      requested_by text,
      assigned_permission text,
      expires_at timestamptz,
      decided_by text,
      decided_at timestamptz,
      comment text,
      created_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL DEFAULT ` +
      tenantDefault +
      `
    )`,
    "ALTER TABLE facilis_tasks ENABLE ROW LEVEL SECURITY",
    ...getTableConfig(facilisTasks).policies.map((policy) =>
      policyCreateSql("facilis_tasks", policy),
    ),
  ];
  await db.db.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  });
  await ensureAppRole(db);
  return { db, store: createDbTaskStore({ db, tenantId: TENANT_ID }) };
}

/** Empties the table as the connecting superuser, so each test starts from a clean slate. */
export async function clearTasks(db: FacilisDb): Promise<void> {
  await db.db.execute(sql.raw("delete from facilis_tasks"));
}

let sequence = 0;

export function newTask(overrides: Partial<NewStoredTask> = {}): NewStoredTask {
  sequence += 1;
  return {
    id: randomUUID(),
    workflowId: null,
    stepIndex: null,
    kind: "approval",
    titleKey: "todos.approval",
    titleParams: { title: "Buy milk" },
    payload: { todoId: "todo-1" },
    requestedBy: "system:test",
    assignedPermission: null,
    expiresAt: null,
    createdAt: new Date(BASE.getTime() + sequence),
    ...overrides,
  };
}
