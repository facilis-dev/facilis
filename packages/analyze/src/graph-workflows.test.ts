import { describe, expect, it } from "vitest";

import { buildProjectGraph } from "./graph.ts";
import type { SourceRef, WorkflowFact } from "./types.ts";

const ref = (file: string): SourceRef => ({ file, line: 1 });

function workflow(): WorkflowFact {
  const source = ref("server/workflows/purge.ts");
  return {
    name: "purge",
    sourceFile: "server/workflows/purge.ts",
    source,
    steps: [
      { index: 0, kind: "job", name: "purge-todos", permission: null, onRejectStep: null, source },
      {
        index: 1,
        kind: "approval",
        name: "workflows.purge.approval",
        permission: "tasks:decide",
        onRejectStep: 2,
        source,
      },
      { index: 2, kind: "job", name: "notify", permission: null, onRejectStep: null, source },
    ],
    unknown: [],
  };
}

describe("buildProjectGraph workflows", () => {
  it("adds one workflow node per definition, with its steps", () => {
    const graph = buildProjectGraph({
      routes: [],
      tables: [],
      relations: [],
      pages: [],
      views: [],
      workflows: [workflow()],
    });
    const node = graph.nodes.find((candidate) => candidate.id === "workflow:purge");
    expect(node).toMatchObject({
      kind: "workflow",
      label: "purge",
      sourceFile: "server/workflows/purge.ts",
    });
    expect(node?.data).toEqual({
      kind: "workflow",
      name: "purge",
      unknown: false,
      steps: [
        { index: 0, kind: "job", name: "purge-todos", permission: null, onRejectStep: null },
        {
          index: 1,
          kind: "approval",
          name: "workflows.purge.approval",
          permission: "tasks:decide",
          onRejectStep: 2,
        },
        { index: 2, kind: "job", name: "notify", permission: null, onRejectStep: null },
      ],
    });
    expect(graph.edges).toEqual([]);
  });

  it("marks a definition with an unreadable step as unknown", () => {
    const fact = workflow();
    const first = fact.steps[0];
    if (first === undefined) throw new Error("workflow fixture has no steps");
    const graph = buildProjectGraph({
      routes: [],
      tables: [],
      relations: [],
      pages: [],
      views: [],
      workflows: [
        {
          ...fact,
          steps: [{ ...first, name: null }],
          unknown: [
            {
              code: "workflow-definition-static",
              reason: "step 0: job name cannot be read statically",
              source: fact.source,
            },
          ],
        },
      ],
    });
    expect(graph.nodes[0]?.data).toMatchObject({ kind: "workflow", unknown: true });
  });
});
