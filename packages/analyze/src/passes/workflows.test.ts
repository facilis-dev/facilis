import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { buildWorkflowFacts } from "./workflows.ts";

const parser = createOxcParser();

function graphOf(files: Record<string, string>) {
  return createModuleGraph({ files: new Map(Object.entries(files)), parser });
}

const HEADER = 'import { defineWorkflow } from "@facilis/core";\n';

describe("buildWorkflowFacts", () => {
  it("reads the name, steps, assignment and reject branch", () => {
    const source =
      HEADER +
      `export default defineWorkflow({
  name: "purge",
  input: { safeParse: () => ({ success: true }) },
  steps: [
    { job: "purge-todos" },
    {
      approval: {
        titleKey: "workflows.purge.approval",
        permission: "tasks:decide",
        onReject: { step: 2 },
        params: () => ({ days: 7 }),
      },
    },
    { job: "notify" },
  ],
});`;
    const { workflows, diagnostics } = buildWorkflowFacts(
      graphOf({ "server/workflows/purge.ts": source }),
    );
    expect(diagnostics).toEqual([]);
    expect(workflows).toHaveLength(1);
    expect(workflows[0]).toMatchObject({
      name: "purge",
      sourceFile: "server/workflows/purge.ts",
      unknown: [],
    });
    expect(workflows[0]?.steps.map((step) => [step.kind, step.name])).toEqual([
      ["job", "purge-todos"],
      ["approval", "workflows.purge.approval"],
      ["job", "notify"],
    ]);
    expect(workflows[0]?.steps[1]).toMatchObject({
      permission: "tasks:decide",
      onRejectStep: 2,
    });
  });

  it("ignores non-workflow directories and test files", () => {
    const { workflows, diagnostics } = buildWorkflowFacts(
      graphOf({
        "server/jobs/purge.ts": HEADER + "export default {};",
        "server/workflows/purge.test.ts": HEADER + "export default {};",
      }),
    );
    expect(workflows).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it("warns when the default export is not a defineWorkflow call", () => {
    const { workflows, diagnostics } = buildWorkflowFacts(
      graphOf({ "server/workflows/bad.ts": "export default {};" }),
    );
    expect(workflows).toEqual([]);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "workflow-definition", severity: "warning" }),
    ]);
  });

  it("keeps an unreadable step visible as unknown instead of guessing", () => {
    const source =
      HEADER +
      `export default defineWorkflow({
  name: "purge",
  steps: [{ job: dynamicName() }],
});`;
    const { workflows } = buildWorkflowFacts(graphOf({ "server/workflows/purge.ts": source }));
    expect(workflows[0]?.steps[0]?.name).toBeNull();
    expect(workflows[0]?.unknown).toHaveLength(1);
  });
});
