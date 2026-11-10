import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defineWorkflow,
  isWorkflowDefinition,
  serializeWorkflowData,
  unavailableWorkflows,
  WorkflowError,
  type WorkflowDefinition,
} from "./workflows.ts";

const VALID = {
  name: "order-approval",
  input: z.object({ orderId: z.string() }),
  output: z.object({ shipped: z.boolean() }),
  steps: [
    { job: "reserve-stock" },
    { approval: { titleKey: "workflow.order.approve" } },
    { job: "ship-order", input: ({ input }: { input: { orderId: string } }) => input },
  ],
};

describe("defineWorkflow", () => {
  it("accepts a job/approval/job chain", () => {
    const workflow = defineWorkflow(VALID);
    expect(workflow.name).toBe("order-approval");
    expect(workflow.steps).toHaveLength(3);
  });

  it("accepts a definition without an output schema", () => {
    expect(() => defineWorkflow({ ...VALID, output: undefined })).not.toThrow();
  });

  it("rejects an invalid name, missing schema and empty steps", () => {
    expect(() => defineWorkflow({ ...VALID, name: "Order Approval" })).toThrow(TypeError);
    expect(() => defineWorkflow({ ...VALID, input: undefined as never })).toThrow(TypeError);
    expect(() => defineWorkflow({ ...VALID, steps: [] })).toThrow(TypeError);
  });

  it("rejects a step that is both or neither kind", () => {
    expect(() =>
      defineWorkflow({
        ...VALID,
        steps: [{ job: "ship-order", approval: { titleKey: "x" } } as never],
      }),
    ).toThrow(TypeError);
    expect(() => defineWorkflow({ ...VALID, steps: [{} as never] })).toThrow(TypeError);
  });

  it("rejects a malformed job name, title key or ttl", () => {
    expect(() => defineWorkflow({ ...VALID, steps: [{ job: "Ship Order" }] })).toThrow(TypeError);
    expect(() =>
      defineWorkflow({ ...VALID, steps: [{ approval: { titleKey: "not a key" } }] }),
    ).toThrow(TypeError);
    expect(() =>
      defineWorkflow({ ...VALID, steps: [{ approval: { titleKey: "x", ttlMs: 0 } }] }),
    ).toThrow(TypeError);
  });
});

describe("isWorkflowDefinition", () => {
  it("recognizes a defined workflow", () => {
    expect(isWorkflowDefinition(defineWorkflow(VALID))).toBe(true);
  });

  it("rejects foreign, incomplete and malformed values", () => {
    expect(isWorkflowDefinition(undefined)).toBe(false);
    expect(isWorkflowDefinition(null)).toBe(false);
    expect(isWorkflowDefinition({ name: "x" })).toBe(false);
    expect(
      isWorkflowDefinition({
        ...VALID,
        steps: [{ approval: { titleKey: "x", params: "not-a-function" } }],
      }),
    ).toBe(false);
  });
});

describe("serializeWorkflowData", () => {
  it("round-trips JSON data", () => {
    expect(serializeWorkflowData({ orderId: "o-1", nested: [1, true, null] })).toEqual({
      orderId: "o-1",
      nested: [1, true, null],
    });
  });

  it("rejects data that cannot survive the JSON boundary", () => {
    expect(() => serializeWorkflowData(undefined)).toThrow(
      expect.objectContaining({ code: "workflow_invalid_input" }),
    );
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(() => serializeWorkflowData(circular)).toThrow(
      expect.objectContaining({ code: "workflow_invalid_input" }),
    );
  });
});

describe("unavailableWorkflows", () => {
  it("rejects every call with workflow_unavailable", async () => {
    const api = unavailableWorkflows();
    await expect(api.start("order-approval", {})).rejects.toMatchObject({
      code: "workflow_unavailable",
    });
    await expect(api.get("id")).rejects.toMatchObject({ code: "workflow_unavailable" });
    await expect(api.list()).rejects.toMatchObject({ code: "workflow_unavailable" });
    await expect(api.cancel("id")).rejects.toMatchObject({ code: "workflow_unavailable" });
    expect(api.bindScope?.({} as never)).toBe(api);
  });
});

describe("WorkflowError", () => {
  it("is a coded error with a stable name", () => {
    const error = new WorkflowError("workflow_interrupted", "stopped");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("WorkflowError");
    expect(error.code).toBe("workflow_interrupted");
  });
});

// Compile-time check that the generic input type flows into the resolvers.
const typed: WorkflowDefinition<{ orderId: string }, { shipped: boolean }> = defineWorkflow(VALID);
void typed;
