import { describe, expect, it } from "vitest";
import { defineWorkflow } from "@facilis/core";

import { buildWorkflowRegistry } from "./definitions.ts";
import { FakeJobs } from "./workflows-test-harness.ts";

const JOBS = FakeJobs.definitions("reserve-stock", "ship-order");

/** Any input passes: registry indexing is the subject of this file, not Zod. */
const ANY_INPUT = {
  safeParse: (value: unknown) => ({ success: true, data: value }),
} as never;

function workflow(overrides: { name?: string; job?: string } = {}) {
  return defineWorkflow({
    name: overrides.name ?? "order-approval",
    input: ANY_INPUT,
    steps: [{ job: overrides.job ?? "reserve-stock" }, { approval: { titleKey: "order.approve" } }],
  });
}

describe("buildWorkflowRegistry", () => {
  it("indexes valid definitions", () => {
    const registry = buildWorkflowRegistry(
      [{ file: "server/workflows/order.ts", definition: workflow() }],
      JOBS,
    );
    expect([...registry.definitions.keys()]).toEqual(["order-approval"]);
    expect(registry.warnings).toEqual([]);
  });

  it("warns and skips a module that is not a workflow definition", () => {
    const registry = buildWorkflowRegistry(
      [{ file: "server/workflows/broken.ts", definition: { name: "x" } }],
      JOBS,
    );
    expect(registry.definitions.size).toBe(0);
    expect(registry.warnings).toEqual([
      expect.objectContaining({
        code: "workflow_definition_invalid",
        sourceFile: "server/workflows/broken.ts",
      }),
    ]);
  });

  it("keeps the first of two definitions with the same name", () => {
    const registry = buildWorkflowRegistry(
      [
        { file: "server/workflows/a.ts", definition: workflow() },
        { file: "server/workflows/b.ts", definition: workflow() },
      ],
      JOBS,
    );
    expect(registry.definitions.size).toBe(1);
    expect(registry.warnings).toEqual([
      expect.objectContaining({
        code: "workflow_definition_invalid",
        sourceFile: "server/workflows/b.ts",
      }),
    ]);
  });

  it("skips a workflow whose job step is not defined", () => {
    const registry = buildWorkflowRegistry(
      [{ file: "server/workflows/dangling.ts", definition: workflow({ job: "missing-job" }) }],
      JOBS,
    );
    expect(registry.definitions.size).toBe(0);
    expect(registry.warnings[0]?.message).toContain('unknown job "missing-job"');
  });
});
