import { describe, expect, it } from "vitest";
import { GRAPH_EDGE_KINDS } from "./graph-types";
import {
  DEFAULT_GRAPH_VIEW_STATE,
  GRAPH_LENS_IDS,
  decodeGraphViewState,
  encodeGraphViewState,
  type GraphViewState,
} from "./graph-view-state";
import {
  GRAPH_VIEW_PARAM,
  GRAPH_VIEW_URL_MAX_LENGTH,
  graphViewRootAction,
  graphViewSearch,
  readGraphViewParam,
  withGraphViewParam,
} from "./graph-view-state-url";

const state = (overrides: Partial<GraphViewState> = {}): GraphViewState => ({
  ...DEFAULT_GRAPH_VIEW_STATE,
  ...overrides,
  filters: { ...DEFAULT_GRAPH_VIEW_STATE.filters, ...overrides.filters },
});

const bytes = (value: string): number => new TextEncoder().encode(value).length;

describe("gv parameter merge", () => {
  it("reads gv from a search string and reports null when absent", () => {
    expect(readGraphViewParam("?project=%2Fp&gv=%7B%7D&net=1")).toBe("{}");
    expect(readGraphViewParam("?project=%2Fp")).toBeNull();
    expect(readGraphViewParam("")).toBeNull();
  });

  it("preserves every other parameter's value and position when setting gv", () => {
    const search = withGraphViewParam("?project=%2Fhome%2Fu%2Fp&net=1", '{"q":"x"}');
    const params = new URLSearchParams(search);
    expect(params.get("project")).toBe("/home/u/p");
    expect(params.get("net")).toBe("1");
    expect(params.get(GRAPH_VIEW_PARAM)).toBe('{"q":"x"}');
    expect([...params.keys()]).toEqual(["project", "net", GRAPH_VIEW_PARAM]);
  });

  it("updates an existing gv in place and removes only gv on null/empty", () => {
    const updated = new URLSearchParams(withGraphViewParam("?gv=old&project=p", "new"));
    expect([...updated.keys()]).toEqual([GRAPH_VIEW_PARAM, "project"]);
    expect(updated.get(GRAPH_VIEW_PARAM)).toBe("new");
    expect(withGraphViewParam("?project=p&gv=x&net=1", null)).toBe("project=p&net=1");
    expect(withGraphViewParam("?project=p&gv=x", "")).toBe("project=p");
    expect(withGraphViewParam("", '{"q":"x"}')).toBe("gv=%7B%22q%22%3A%22x%22%7D");
  });

  it("survives percent-encoding with unicode payloads", () => {
    const encoded = encodeGraphViewState(state({ query: "検索 🎉", selection: "table:予定" }));
    const search = withGraphViewParam("?project=%2Fp", encoded);
    expect(readGraphViewParam(search)).toBe(encoded);
    expect(decodeGraphViewState(readGraphViewParam(search)).query).toBe("検索 🎉");
  });

  it("removes gv for the default view so an untouched tab keeps a clean URL", () => {
    expect(graphViewSearch("?project=p&gv=stale", DEFAULT_GRAPH_VIEW_STATE)).toBe("project=p");
  });

  it("carries the concentration threshold through the URL and nothing hub-related (#64)", () => {
    const next = state({ edgeConcentration: "off", query: "tasks" });
    const search = graphViewSearch("?project=p&net=1", next);
    const decoded = decodeGraphViewState(readGraphViewParam(search));
    expect(decoded.edgeConcentration).toBe("off");
    expect(decoded.query).toBe("tasks");
    expect(readGraphViewParam(search)?.includes("hub:")).toBe(false);
    expect(new URLSearchParams(search).get("net")).toBe("1");
  });

  it("carries the runtime lens options through the gv merge and percent-encoding", () => {
    const next = state({
      activeLenses: ["runtime"],
      runtimeWindow: "15m",
      runtimeLive: true,
      selection: "route:GET /api/todos",
    });
    const search = graphViewSearch("?project=%2Fp&net=1", next);
    const raw = readGraphViewParam(search);
    expect(raw).not.toBeNull();
    const decoded = decodeGraphViewState(raw);
    expect(decoded.runtimeWindow).toBe("15m");
    expect(decoded.runtimeLive).toBe(true);
    expect(decoded.activeLenses).toEqual(["runtime"]);
    // The whole view round-trips byte-identically through the URL parameter.
    expect(encodeGraphViewState(decoded)).toBe(encodeGraphViewState(next));
    expect(new URLSearchParams(search).get("project")).toBe("/p");
  });
});

describe("root reset decision", () => {
  it("adopts the deep link on the first project and keeps it on the same root", () => {
    expect(graphViewRootAction(null, "/a")).toBe("adopt");
    expect(graphViewRootAction("/a", "/a")).toBe("none");
  });

  it("resets when the root changes or the project closes", () => {
    expect(graphViewRootAction("/a", "/b")).toBe("reset");
    expect(graphViewRootAction("/a", null)).toBe("reset");
  });

  it("leaves the URL alone on a cold boot without a project (the deep link must survive)", () => {
    expect(graphViewRootAction(null, null)).toBe("none");
  });
});

describe("2 KB URL budget for a 500-node project", () => {
  // 500 analyzed nodes; the worst case collapses half of them and carries selection, user
  // focus, every lens, every hidden edge kind, a viewport and a unicode query.
  const nodeIds = Array.from(
    { length: 500 },
    (_, index) => `table:user_settings_${String(index).padStart(3, "0")}`,
  );
  const base = "https://ide.facilis.dev/";
  const projectSearch = `?project=${encodeURIComponent("/home/user/projects/big-app")}`;
  const worst = state({
    mode: "timeline",
    activeLenses: [...GRAPH_LENS_IDS],
    isolatedNode: nodeIds[9],
    selection: nodeIds[7],
    focus: nodeIds.slice(100, 110),
    filters: { hiddenEdgeKinds: [...GRAPH_EDGE_KINDS], tableVisibility: "used" },
    collapsed: nodeIds.slice(0, 250),
    viewport: { x: -1234.56, y: 789.01, zoom: 0.424 },
    query: "検索 todos 🎉 café settings",
  });

  it("the unbounded worst case really exceeds the budget (the test is not vacuous)", () => {
    const full = base + withGraphViewParam(projectSearch, encodeGraphViewState(worst));
    expect(bytes(full)).toBeGreaterThan(GRAPH_VIEW_URL_MAX_LENGTH);
  });

  it("keeps the whole URL under 2048 bytes, shedding collapsed ids first", () => {
    const search = graphViewSearch(projectSearch, worst, GRAPH_VIEW_URL_MAX_LENGTH - base.length);
    const url = base + search;
    expect(bytes(url)).toBeLessThanOrEqual(GRAPH_VIEW_URL_MAX_LENGTH);
    const decoded = decodeGraphViewState(readGraphViewParam(search), new Set(nodeIds));
    // The addressable essentials survive; only the bulkiest view-only field is shed.
    expect(decoded.mode).toBe("timeline");
    expect(decoded.activeLenses).toEqual([...GRAPH_LENS_IDS]);
    expect(decoded.isolatedNode).toBe(nodeIds[9]);
    expect(decoded.selection).toBe(nodeIds[7]);
    expect(decoded.query).toBe(worst.query);
    expect(decoded.filters).toEqual(worst.filters);
    expect(decoded.viewport).toEqual(worst.viewport);
    expect(decoded.collapsed).toEqual([]);
  });

  it("a realistic 500-node view (30 collapsed clusters) round-trips fully under 2048 bytes", () => {
    const realistic = { ...worst, collapsed: nodeIds.slice(0, 30), focus: nodeIds.slice(100, 104) };
    const search = graphViewSearch(
      projectSearch,
      realistic,
      GRAPH_VIEW_URL_MAX_LENGTH - base.length,
    );
    expect(bytes(base + search)).toBeLessThanOrEqual(GRAPH_VIEW_URL_MAX_LENGTH);
    const decoded = decodeGraphViewState(readGraphViewParam(search), new Set(nodeIds));
    expect(decoded).toEqual(realistic);
  });

  it("drops gv entirely when even the shed snapshot cannot fit the budget", () => {
    const search = graphViewSearch(projectSearch, worst, 10);
    expect(readGraphViewParam(search)).toBeNull();
    expect(new URLSearchParams(search).get("project")).toBe("/home/user/projects/big-app");
  });
});

describe("bridges toggle through the URL (issue #65)", () => {
  it("carries the off state through the gv parameter and back", () => {
    const off = state({ bridges: false });
    const search = withGraphViewParam("?project=%2Fp", encodeGraphViewState(off));
    const raw = readGraphViewParam(search);
    expect(raw).toBe('{"b":false}');
    expect(decodeGraphViewState(raw)).toEqual(off);
  });

  it("keeps the URL clean for the default (bridges on)", () => {
    expect(graphViewSearch("?project=p&gv=stale", state({ bridges: true }))).toBe("project=p");
  });

  it("round-trips the toggle alongside the rest of the view", () => {
    const full = state({
      bridges: false,
      mode: "matrix",
      query: "todos",
      selection: "table:todos",
    });
    const search = graphViewSearch("?project=p", full);
    expect(decodeGraphViewState(readGraphViewParam(search))).toEqual(full);
  });
});
