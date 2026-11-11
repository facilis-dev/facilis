import { describe, expect, it } from "vitest";
import { defineWorkflow, DEFAULT_WORKFLOWS_CONFIG } from "@facilis.dev/core";
import type { ManifestWarning, WorkflowDefinition } from "@facilis.dev/core";
import { createDb } from "@facilis.dev/db";

import type { JobsRuntime } from "../jobs/runtime.ts";
import { bootWorkflows } from "./boot.ts";
import { FakeJobs, createWorkflowsTestContext, TENANT_ID } from "./workflows-test-harness.ts";

/** Any input passes: boot only indexes definitions, it never parses one. */
const ANY_INPUT = {
  safeParse: (value: unknown) => ({ success: true, data: value }),
} as never;

const DEFINE = defineWorkflow({
  name: "order-approval",
  input: ANY_INPUT,
  steps: [{ job: "reserve-stock" }, { approval: { titleKey: "order.approve" } }],
}) as unknown as WorkflowDefinition<unknown, unknown>;

function jobsRuntime(engine: FakeJobs = new FakeJobs()): JobsRuntime {
  return {
    // Boot wiring never calls the API surface in this test.
    api: {} as never,
    engine,
    definitions: FakeJobs.definitions("reserve-stock"),
    start: async () => undefined,
    stop: async () => undefined,
  };
}

const WORKFLOWS_CONFIG = { ...DEFAULT_WORKFLOWS_CONFIG };

describe("bootWorkflows", () => {
  it("disables workflows when persist is false", async () => {
    const { db } = await createWorkflowsTestContext();
    const warnings: ManifestWarning[] = [];
    const runtime = await bootWorkflows({
      db,
      tenantId: TENANT_ID,
      modules: [],
      jobs: jobsRuntime(),
      jobsConfig: {
        maxConcurrent: 1,
        maxAttempts: 1,
        retryDelayMs: 0,
        timeoutMs: 1000,
        pollIntervalMs: 500,
        persist: true,
      },
      workflowsConfig: { ...WORKFLOWS_CONFIG, persist: false },
      warnings,
    });
    expect(runtime).toBeNull();
    expect(warnings).toEqual([expect.objectContaining({ code: "workflows_disabled" })]);
  });

  it("disables workflows when the job queue is unavailable", async () => {
    const { db } = await createWorkflowsTestContext();
    const warnings: ManifestWarning[] = [];
    const runtime = await bootWorkflows({
      db,
      tenantId: TENANT_ID,
      modules: [],
      jobs: null,
      jobsConfig: {
        maxConcurrent: 1,
        maxAttempts: 1,
        retryDelayMs: 0,
        timeoutMs: 1000,
        pollIntervalMs: 500,
        persist: true,
      },
      workflowsConfig: WORKFLOWS_CONFIG,
      warnings,
    });
    expect(runtime).toBeNull();
    expect(warnings[0]).toMatchObject({ code: "workflows_disabled" });
  });

  it("disables workflows when the tables are missing", async () => {
    const db = await createDb();
    const warnings: ManifestWarning[] = [];
    const runtime = await bootWorkflows({
      db,
      tenantId: TENANT_ID,
      modules: [],
      jobs: jobsRuntime(),
      jobsConfig: {
        maxConcurrent: 1,
        maxAttempts: 1,
        retryDelayMs: 0,
        timeoutMs: 1000,
        pollIntervalMs: 500,
        persist: true,
      },
      workflowsConfig: WORKFLOWS_CONFIG,
      warnings,
    });
    expect(runtime).toBeNull();
    expect(warnings[0]).toMatchObject({ code: "workflows_table_missing" });
  });

  it("boots the runtime and pushes registry warnings into the manifest", async () => {
    const { db } = await createWorkflowsTestContext();
    const warnings: ManifestWarning[] = [];
    const runtime = await bootWorkflows({
      db,
      tenantId: TENANT_ID,
      modules: [
        { file: "server/workflows/order.ts", definition: DEFINE },
        { file: "server/workflows/dangling.ts", definition: { name: "broken" } },
      ],
      jobs: jobsRuntime(),
      jobsConfig: {
        maxConcurrent: 1,
        maxAttempts: 1,
        retryDelayMs: 0,
        timeoutMs: 1000,
        pollIntervalMs: 500,
        persist: true,
      },
      workflowsConfig: WORKFLOWS_CONFIG,
      warnings,
    });

    expect(runtime).not.toBeNull();
    expect(warnings).toEqual([
      expect.objectContaining({
        code: "workflow_definition_invalid",
        sourceFile: "server/workflows/dangling.ts",
      }),
    ]);
    await runtime?.stop();
  });
});
