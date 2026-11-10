// Shared PGlite fixture for the workflow suite (D-135). It creates both real table
// definitions, their policies and the tenant defaults, so the store and runner are exercised
// through the same RLS boundary the runtime uses in dev.
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import type { JobDefinition, JobJson, JobStatus } from "@facilis/core";
import type { FacilisDb } from "@facilis/db";
import {
  createDb,
  ensureAppRole,
  facilisTasks,
  facilisWorkflows,
  policyCreateSql,
  tenantDefaultSql,
} from "@facilis/db";

import type { JobCounts, JobEngine } from "../jobs/contracts.ts";
import { createDbTaskStore } from "../tasks/db-store.ts";
import { createDbWorkflowStore } from "./db-store.ts";

/** Deployment tenant; a second tenant proves the RLS boundary cannot be crossed. */
export const TENANT_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
export const OTHER_TENANT = "ffffffff-ffff-ffff-ffff-ffffffffffff";
export const BASE = new Date("2026-11-10T12:00:00.000Z");

export interface FakeJob {
  id: string;
  name: string;
  status: JobStatus;
  input: JobJson;
  output: JobJson | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  runAt: Date;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/**
 * The runner only needs enqueue/get/cancel from the queue; this fake lets a test decide when
 * a step job succeeds, fails or disappears (boot recovery) without a real scheduler.
 */
export class FakeJobs implements JobEngine {
  readonly jobs = new Map<string, FakeJob>();
  private sequence = 0;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async enqueue(name: string, data: unknown): Promise<{ id: string }> {
    this.sequence += 1;
    const id = randomUUID();
    const at = new Date(BASE.getTime() + this.sequence * 1000);
    this.jobs.set(id, {
      id,
      name,
      status: "queued",
      input: data as JobJson,
      output: null,
      error: null,
      attempts: 0,
      maxAttempts: 2,
      timeoutMs: 30_000,
      runAt: at,
      createdAt: at,
      startedAt: null,
      finishedAt: null,
    });
    return { id };
  }

  async get(id: string): Promise<FakeJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async list(): Promise<FakeJob[]> {
    return [...this.jobs.values()];
  }

  async queue(): Promise<FakeJob[]> {
    return this.list();
  }

  async running(): Promise<FakeJob[]> {
    return this.list();
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (job === undefined || isTerminal(job.status)) return false;
    job.status = "cancelled";
    job.finishedAt = new Date(BASE.getTime() + this.sequence * 1000);
    return true;
  }

  async stats(): Promise<JobCounts> {
    return { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
  }

  scoped(): JobEngine {
    return this;
  }

  /** The job row remains but settles as succeeded (what advance() reads on the next tick). */
  succeed(id: string, output: JobJson = null): void {
    const job = this.required(id);
    job.status = "succeeded";
    job.output = output;
    job.finishedAt = new Date();
  }

  fail(id: string, error: string): void {
    const job = this.required(id);
    job.status = "failed";
    job.error = error;
    job.finishedAt = new Date();
  }

  /** Boot recovery case: the queue lost the row entirely. */
  forget(id: string): void {
    this.jobs.delete(id);
  }

  /** A definition the runner validates a dangling step against. */
  static definitions(...names: string[]): ReadonlyMap<string, JobDefinition<unknown, unknown>> {
    return new Map(
      names.map((name) => [
        name,
        {
          name,
          input: { safeParse: (value: unknown) => ({ success: true, data: value }) },
          output: { safeParse: (value: unknown) => ({ success: true, data: value }) },
          run: () => undefined,
        } as unknown as JobDefinition<unknown, unknown>,
      ]),
    );
  }

  lastEnqueuedName(): string | null {
    const jobs = [...this.jobs.values()];
    return jobs.length === 0 ? null : (jobs[jobs.length - 1]?.name ?? null);
  }

  get latest(): FakeJob | undefined {
    const jobs = [...this.jobs.values()];
    return jobs[jobs.length - 1];
  }

  private required(id: string): FakeJob {
    const job = this.jobs.get(id);
    if (job === undefined) throw new Error("unknown fake job " + id);
    return job;
  }
}

function isTerminal(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export interface WorkflowsTestContext {
  readonly db: FacilisDb;
  readonly workflows: ReturnType<typeof createDbWorkflowStore>;
  readonly tasks: ReturnType<typeof createDbTaskStore>;
  readonly jobs: FakeJobs;
}

export async function createWorkflowsTestContext(): Promise<WorkflowsTestContext> {
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
      tenant_id uuid NOT NULL DEFAULT ${tenantDefault}
    )`,
    "ALTER TABLE facilis_tasks ENABLE ROW LEVEL SECURITY",
    `CREATE TABLE facilis_workflows (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      status text NOT NULL,
      input jsonb NOT NULL,
      progress jsonb NOT NULL DEFAULT '[]'::jsonb,
      plan jsonb NOT NULL DEFAULT '[]'::jsonb,
      current_step integer NOT NULL DEFAULT 0,
      current_job_id uuid,
      waiting_task_id uuid,
      attempts integer NOT NULL DEFAULT 0,
      output jsonb,
      error text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL DEFAULT ${tenantDefault}
    )`,
    "ALTER TABLE facilis_workflows ENABLE ROW LEVEL SECURITY",
    ...getTableConfig(facilisTasks).policies.map((policy) =>
      policyCreateSql("facilis_tasks", policy),
    ),
    ...getTableConfig(facilisWorkflows).policies.map((policy) =>
      policyCreateSql("facilis_workflows", policy),
    ),
  ];
  await db.db.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  });
  await ensureAppRole(db);
  return {
    db,
    workflows: createDbWorkflowStore({ db, tenantId: TENANT_ID }),
    tasks: createDbTaskStore({ db, tenantId: TENANT_ID }),
    jobs: new FakeJobs(),
  };
}

export async function clearWorkflows(db: FacilisDb): Promise<void> {
  await db.db.execute(sql.raw("delete from facilis_workflows"));
  await db.db.execute(sql.raw("delete from facilis_tasks"));
}
