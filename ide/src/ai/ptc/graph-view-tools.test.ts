import { describe, expect, it } from "vitest";
import { MAX_HOPS, MAX_PATHS } from "@/facilis/graph-paths";
import type {
  GraphCaptureRequest,
  GraphHighlightRequest,
  GraphPathsRequest,
  GraphViewAccess,
} from "../graph-view-access";
import type { PatchValidationHost } from "../patch-validation";
import { createRuntimeToolHandlers } from "./graph-tools";
import { createGraphViewHandlers, type GraphViewHandler } from "./graph-view-tools";
import { isPtcToolError } from "./protocol";

interface Calls {
  highlights: GraphHighlightRequest[];
  paths: GraphPathsRequest[];
  captures: GraphCaptureRequest[];
}

function fakeAccess(): { access: GraphViewAccess; calls: Calls } {
  const calls: Calls = { highlights: [], paths: [], captures: [] };
  return {
    calls,
    access: {
      highlight: async (request) => {
        calls.highlights.push(request);
        return { ok: true };
      },
      paths: async (request) => {
        calls.paths.push(request);
        return { ok: true };
      },
      capture: async (request) => {
        calls.captures.push(request);
        return { captured: true };
      },
      takeImages: () => [],
    },
  };
}

function handlerOf(
  handlers: Readonly<Record<string, GraphViewHandler>>,
  name: string,
): GraphViewHandler {
  const handler = handlers[name];
  if (handler === undefined) throw new Error("missing handler: " + name);
  return handler;
}

async function refusal(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    throw new Error("expected the call to be refused");
  } catch (error) {
    if (!isPtcToolError(error)) throw error;
    expect(error.kind).toBe("capability");
    return error.message;
  }
}

describe("graph view family registration", () => {
  it("is composed by the runtime router when the host has a graph view", () => {
    const { access } = fakeAccess();
    const host = {
      files: () => [],
      read: async () => "",
      manifestBase: () => null,
      analyze: () => Promise.reject(new Error("not used")),
      graphView: access,
    } as unknown as PatchValidationHost;
    const handlers = createRuntimeToolHandlers(host);
    expect(Object.keys(handlers)).toEqual(["graph_highlight", "graph_paths", "graph_screenshot"]);
  });

  it("is absent when the host has no graph view", () => {
    const host = {
      files: () => [],
      read: async () => "",
      manifestBase: () => null,
      analyze: () => Promise.reject(new Error("not used")),
    } as unknown as PatchValidationHost;
    expect(Object.keys(createRuntimeToolHandlers(host))).toEqual([]);
  });
});

describe("graph_highlight handler", () => {
  it("defaults to clearing the focus and fitting the viewport", async () => {
    const { access, calls } = fakeAccess();
    const highlight = handlerOf(createGraphViewHandlers(access), "graph_highlight");
    expect(await highlight({})).toEqual({ ok: true });
    expect(calls.highlights).toEqual([{ nodes: [], edges: [], zoom: true }]);
  });

  it("passes ids and zoom through, deduplicated", async () => {
    const { access, calls } = fakeAccess();
    const highlight = handlerOf(createGraphViewHandlers(access), "graph_highlight");
    await highlight({ nodes: ["table:todos", "table:todos"], edges: ["fk:1"], zoom: false });
    expect(calls.highlights).toEqual([{ nodes: ["table:todos"], edges: ["fk:1"], zoom: false }]);
  });

  it("refuses malformed id lists and a non-boolean zoom", async () => {
    const { access } = fakeAccess();
    const highlight = handlerOf(createGraphViewHandlers(access), "graph_highlight");
    expect(await refusal(() => highlight({ nodes: "table:todos" }))).toContain("nodes");
    expect(await refusal(() => highlight({ nodes: [1] }))).toContain("nodes");
    expect(await refusal(() => highlight({ edges: [""] }))).toContain("edges");
    expect(await refusal(() => highlight({ zoom: "yes" }))).toContain("zoom");
    const tooMany = Array.from({ length: 201 }, (_value, index) => "table:t" + String(index));
    expect(await refusal(() => highlight({ nodes: tooMany }))).toContain("at most");
  });
});

describe("graph_paths handler", () => {
  it("applies the documented defaults", async () => {
    const { access, calls } = fakeAccess();
    const paths = handlerOf(createGraphViewHandlers(access), "graph_paths");
    await paths({ from: "table:todos" });
    expect(calls.paths).toEqual([
      { from: "table:todos", maxPaths: MAX_PATHS, maxHops: MAX_HOPS, highlight: true },
    ]);
  });

  it("passes a target, both caps and the highlight flag through", async () => {
    const { access, calls } = fakeAccess();
    const paths = handlerOf(createGraphViewHandlers(access), "graph_paths");
    await paths({
      from: "table:todos",
      to: "route:GET /api/todos",
      maxPaths: 3,
      maxHops: 4,
      highlight: false,
    });
    expect(calls.paths).toEqual([
      {
        from: "table:todos",
        to: "route:GET /api/todos",
        maxPaths: 3,
        maxHops: 4,
        highlight: false,
      },
    ]);
  });

  it("refuses a missing from and out-of-range caps", async () => {
    const { access } = fakeAccess();
    const paths = handlerOf(createGraphViewHandlers(access), "graph_paths");
    expect(await refusal(() => paths({}))).toContain("from");
    expect(await refusal(() => paths({ from: "" }))).toContain("from");
    expect(await refusal(() => paths({ from: "a", maxPaths: MAX_PATHS + 1 }))).toContain(
      "maxPaths",
    );
    expect(await refusal(() => paths({ from: "a", maxPaths: 0 }))).toContain("maxPaths");
    expect(await refusal(() => paths({ from: "a", maxPaths: 2.5 }))).toContain("maxPaths");
    expect(await refusal(() => paths({ from: "a", maxHops: MAX_HOPS + 1 }))).toContain("maxHops");
    expect(await refusal(() => paths({ from: "a", highlight: 1 }))).toContain("highlight");
  });
});

describe("graph_screenshot handler", () => {
  it("defaults to the whole visible view", async () => {
    const { access, calls } = fakeAccess();
    const screenshot = handlerOf(createGraphViewHandlers(access), "graph_screenshot");
    expect(await screenshot({})).toEqual({ captured: true });
    expect(calls.captures).toEqual([{}]);
  });

  it("passes an id subset through", async () => {
    const { access, calls } = fakeAccess();
    const screenshot = handlerOf(createGraphViewHandlers(access), "graph_screenshot");
    await screenshot({ nodes: ["table:todos"], edges: ["fk:1"] });
    expect(calls.captures).toEqual([{ nodes: ["table:todos"], edges: ["fk:1"] }]);
  });

  it("refuses malformed ids", async () => {
    const { access } = fakeAccess();
    const screenshot = handlerOf(createGraphViewHandlers(access), "graph_screenshot");
    expect(await refusal(() => screenshot({ edges: "fk:1" }))).toContain("edges");
    expect(await refusal(() => screenshot({ nodes: [null] }))).toContain("nodes");
  });
});
