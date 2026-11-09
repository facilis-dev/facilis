import { describe, expect, it } from "vitest";
import type { GraphAccess } from "../graph-access";
import { analyzeHostFiles } from "../analysis-fixtures";
import type { PatchValidationHost } from "../patch-validation";
import { TOOL_SPECS } from "./tool-specs";
import { isPtcToolError, PtcToolError, type PtcJson } from "./protocol";
import { createToolRouter } from "./tools";

function access(overrides: Partial<GraphAccess> = {}): GraphAccess {
  return {
    available: () => true,
    state: async () => ({ available: true, nodes: [], edges: [], notes: [] }),
    apply: async (plan) => ({ ok: true, echo: plan as PtcJson }),
    ...overrides,
  };
}

const noFiles = (): readonly string[] => [];
const readNothing = async (): Promise<string> => "";

function host(graph: GraphAccess | undefined): PatchValidationHost {
  return {
    files: noFiles,
    read: readNothing,
    manifestBase: () => null,
    analyze: (patches) => analyzeHostFiles(noFiles(), readNothing, patches),
    ...(graph === undefined ? {} : { graph }),
  };
}

async function call(
  name: string,
  args: unknown,
  graph: GraphAccess | null = access(),
): Promise<PtcJson> {
  return createToolRouter(host(graph ?? undefined)).execute({ name, args }, {});
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (isPtcToolError(error)) return error;
    throw error;
  }
  throw new Error("expected the tool call to be refused");
}

describe("graph tools", () => {
  it("advertises graph_state and graph_arrange only with a graph access", () => {
    const withGraph = createToolRouter(host(access()))
      .specs()
      .map((spec) => spec.name);
    const without = createToolRouter(host(undefined))
      .specs()
      .map((spec) => spec.name);
    expect(withGraph).toContain("graph_state");
    expect(withGraph).toContain("graph_arrange");
    expect(without).not.toContain("graph_state");
    expect(without).toEqual(TOOL_SPECS.map((spec) => spec.name));
  });

  it("reads the graph state and reports no project as data", async () => {
    await expect(call("graph_state", {})).resolves.toMatchObject({ available: true });
    const offline = access({ available: () => false });
    await expect(call("graph_state", {}, offline)).resolves.toMatchObject({ available: false });
  });

  it("forwards the arrangement plan to the access facade", async () => {
    await expect(
      call("graph_arrange", { moves: [{ id: "table:todos", x: 1, y: 2 }] }),
    ).resolves.toEqual({ ok: true, echo: { moves: [{ id: "table:todos", x: 1, y: 2 }] } });
  });

  it("formats a validation refusal with the tool name and signature", async () => {
    const rejecting = access({
      apply: async () => {
        throw new PtcToolError("capability", "moves[0].x must be a finite number");
      },
    });
    const error = await refusal(call("graph_arrange", { moves: [] }, rejecting));
    expect(error.message).toContain("graph_arrange graph_arrange(");
    expect(error.message).toContain("moves[0].x must be a finite number");
  });

  it("refuses arguments that are not one JSON object", async () => {
    const error = await refusal(call("graph_arrange", []));
    expect(error.message).toContain("one JSON object");
  });

  it("degrades to 'not implemented' when the host has no graph", async () => {
    const error = await refusal(call("graph_state", {}, null));
    expect(error.message).toContain("not implemented");
    const arrange = await refusal(call("graph_arrange", {}, null));
    expect(arrange.message).toContain("not implemented");
  });

  it("returns unavailable from graph_arrange when no project is open", async () => {
    const offline = access({ available: () => false });
    await expect(call("graph_arrange", {}, offline)).resolves.toMatchObject({
      available: false,
    });
  });
});
