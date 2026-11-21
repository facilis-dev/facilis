import { describe, expect, it } from "vitest";
import { AUDIT_FILTER_IDS } from "./graph-contract";
import { GRAPH_EDGE_KINDS } from "./graph-types";
import {
  DEFAULT_GRAPH_VIEW_STATE,
  GRAPH_LENS_IDS,
  cycleEdgeConcentration,
  decodeGraphViewState,
  encodeGraphViewState,
  type GraphViewState,
} from "./graph-view-state";

const state = (overrides: Partial<GraphViewState> = {}): GraphViewState => ({
  ...DEFAULT_GRAPH_VIEW_STATE,
  ...overrides,
  filters: { ...DEFAULT_GRAPH_VIEW_STATE.filters, ...overrides.filters },
});

describe("graph view state defaults", () => {
  it("encodes the default view to the empty string (a clean URL)", () => {
    expect(encodeGraphViewState(DEFAULT_GRAPH_VIEW_STATE)).toBe("");
  });

  it("decodes null and empty input to the default view", () => {
    expect(decodeGraphViewState(null)).toEqual(DEFAULT_GRAPH_VIEW_STATE);
    expect(decodeGraphViewState("")).toEqual(DEFAULT_GRAPH_VIEW_STATE);
  });

  it("omits every default field and keeps only what changed", () => {
    expect(encodeGraphViewState(state({ query: "todos" }))).toBe('{"q":"todos"}');
    expect(encodeGraphViewState(state({ selection: "table:todos" }))).toBe('{"s":"table:todos"}');
    expect(encodeGraphViewState(state({ mode: "matrix" }))).toBe('{"m":"matrix"}');
    expect(
      encodeGraphViewState(state({ filters: { hiddenEdgeKinds: [], tableVisibility: "used" } })),
    ).toBe('{"t":"used"}');
  });
});

describe("graph view state round-trips", () => {
  it("round-trips every field, including unicode ids, labels and query", () => {
    const full = state({
      mode: "timeline",
      activeLenses: ["impact", "contract", "roles"],
      isolatedEdgeKinds: ["fk", "page-link"],
      auditFilters: ["protected", "diagnostics"],
      runtimeWindow: "15m",
      runtimeLive: true,
      isolatedNode: "table:予定表",
      selection: "table:予定表",
      impactColumn: "dueDate",
      focus: ["page:/設定", "route:GET /api/検索", "table:café"],
      filters: { hiddenEdgeKinds: [...GRAPH_EDGE_KINDS], tableVisibility: "project" },
      collapsed: ["table:予定表", "view:active_todos"],
      viewport: { x: 120.25, y: -40.5, zoom: 0.875 },
      query: "検索 todos 🎉 café",
      matrixSort: "degree",
    });
    expect(decodeGraphViewState(encodeGraphViewState(full))).toEqual(full);
  });

  it("encodes the impact column under k and omits it when null (issue #74)", () => {
    expect(encodeGraphViewState(state({ impactColumn: "dueDate" }))).toBe('{"k":"dueDate"}');
    expect(encodeGraphViewState(state({ impactColumn: null }))).toBe("");
    const next = state({
      activeLenses: ["impact"],
      selection: "table:todos",
      impactColumn: "dueDate",
    });
    expect(decodeGraphViewState(encodeGraphViewState(next))).toEqual(next);
  });

  it("round-trips every edge-kind set combination (all 128 subsets)", () => {
    for (let mask = 0; mask < 1 << GRAPH_EDGE_KINDS.length; mask += 1) {
      const kinds = GRAPH_EDGE_KINDS.filter((_, index) => (mask & (1 << index)) !== 0);
      const next = state({ filters: { hiddenEdgeKinds: kinds, tableVisibility: "all" } });
      expect(decodeGraphViewState(encodeGraphViewState(next))).toEqual(next);
    }
  });

  it("round-trips every edge-kind isolation set (all 128 subsets), canonically ordered", () => {
    for (let mask = 0; mask < 1 << GRAPH_EDGE_KINDS.length; mask += 1) {
      const kinds = GRAPH_EDGE_KINDS.filter((_, index) => (mask & (1 << index)) !== 0);
      const next = state({ isolatedEdgeKinds: kinds.toReversed() });
      const decoded = decodeGraphViewState(encodeGraphViewState(next));
      expect(decoded.isolatedEdgeKinds).toEqual(kinds);
    }
  });

  it("encodes the runtime lens options under rw/rl and omits the defaults", () => {
    expect(encodeGraphViewState(state({ runtimeWindow: "1m" }))).toBe('{"rw":"1m"}');
    expect(encodeGraphViewState(state({ runtimeLive: true }))).toBe('{"rl":true}');
    expect(encodeGraphViewState(state({ runtimeWindow: "15m", runtimeLive: true }))).toBe(
      '{"rw":"15m","rl":true}',
    );
    expect(encodeGraphViewState(state({ runtimeWindow: "5m", runtimeLive: false }))).toBe("");
  });

  it("round-trips every runtime window and the live toggle", () => {
    for (const window of ["1m", "5m", "15m"] as const) {
      for (const live of [false, true]) {
        const next = state({ runtimeWindow: window, runtimeLive: live });
        expect(decodeGraphViewState(encodeGraphViewState(next))).toEqual(next);
      }
    }
  });

  it("degrades hostile runtime options to the defaults (5m, live off)", () => {
    for (const raw of ['{"rw":"9m"}', '{"rw":5}', '{"rw":null}', '{"rl":"yes"}', '{"rl":1}']) {
      const decoded = decodeGraphViewState(raw);
      expect(decoded.runtimeWindow).toBe("5m");
      expect(decoded.runtimeLive).toBe(false);
    }
  });

  it("encodes isolation under i and omits it when empty", () => {
    expect(encodeGraphViewState(state({ isolatedEdgeKinds: ["relation", "fk"] }))).toBe(
      '{"i":["fk","relation"]}',
    );
    expect(encodeGraphViewState(state({ isolatedEdgeKinds: [] }))).toBe("");
    expect(decodeGraphViewState('{"i":["bogus",3]}').isolatedEdgeKinds).toEqual([]);
  });

  it("encodes the audit filters under a and omits them when empty (issue #69)", () => {
    expect(encodeGraphViewState(state({ auditFilters: ["diagnostics", "protected"] }))).toBe(
      '{"a":["protected","diagnostics"]}',
    );
    expect(encodeGraphViewState(state({ auditFilters: [] }))).toBe("");
    expect(decodeGraphViewState('{"a":["bogus",3]}').auditFilters).toEqual([]);
    expect(decodeGraphViewState('{"a":"protected"}').auditFilters).toEqual([]);
  });

  it("round-trips every audit-filter set (all 16 subsets), canonically ordered", () => {
    for (let mask = 0; mask < 1 << AUDIT_FILTER_IDS.length; mask += 1) {
      const filters = AUDIT_FILTER_IDS.filter((_, index) => (mask & (1 << index)) !== 0);
      const next = state({ auditFilters: filters.toReversed() });
      const decoded = decodeGraphViewState(encodeGraphViewState(next));
      expect(decoded.auditFilters).toEqual(filters);
      // Re-encoding the decoded view is stable: the canonical order is a fixed point.
      expect(encodeGraphViewState(decoded)).toBe(encodeGraphViewState(next));
    }
  });

  it("encodes node isolation under n and omits it when null (issue #66)", () => {
    expect(encodeGraphViewState(state({ isolatedNode: "table:todos" }))).toBe(
      '{"n":"table:todos"}',
    );
    expect(encodeGraphViewState(state({ isolatedNode: null }))).toBe("");
    expect(decodeGraphViewState('{"n":42}').isolatedNode).toBeNull();
    expect(decodeGraphViewState('{"n":""}').isolatedNode).toBeNull();
    const next = state({ isolatedNode: "view:active_todos", selection: "view:active_todos" });
    expect(decodeGraphViewState(encodeGraphViewState(next))).toEqual(next);
  });

  it("round-trips every mode and every single lens", () => {
    for (const mode of ["topology", "matrix", "timeline"] as const) {
      expect(decodeGraphViewState(encodeGraphViewState(state({ mode }))).mode).toBe(mode);
    }
    for (const lens of GRAPH_LENS_IDS) {
      const next = state({ activeLenses: [lens] });
      expect(decodeGraphViewState(encodeGraphViewState(next))).toEqual(next);
    }
  });

  it("encodes the matrix sort under ms and omits the default (issue #67)", () => {
    expect(encodeGraphViewState(state({ matrixSort: "degree" }))).toBe('{"ms":"degree"}');
    expect(encodeGraphViewState(state({ matrixSort: "path" }))).toBe("");
    expect(decodeGraphViewState('{"ms":"bogus"}').matrixSort).toBe("path");
    expect(decodeGraphViewState('{"ms":7}').matrixSort).toBe("path");
    const next = state({ mode: "matrix", matrixSort: "degree" });
    expect(decodeGraphViewState(encodeGraphViewState(next))).toEqual(next);
  });

  it("keeps lens order (the first lens is the dominant one) and deduplicates ids", () => {
    const next = state({
      activeLenses: ["impact", "contract"],
      focus: ["a", "a", "b"],
      collapsed: ["c", "c"],
    });
    const decoded = decodeGraphViewState(encodeGraphViewState(next));
    expect(decoded.activeLenses).toEqual(["impact", "contract"]);
    expect(decoded.focus).toEqual(["a", "b"]);
    expect(decoded.collapsed).toEqual(["c"]);
    expect(decodeGraphViewState(encodeGraphViewState(decoded))).toEqual(decoded);
  });

  it("canonicalizes edge-kind order on both sides so stability holds for any input order", () => {
    const decoded = decodeGraphViewState('{"h":["page-link","fk"]}');
    expect(decoded.filters.hiddenEdgeKinds).toEqual(["fk", "page-link"]);
    const shuffled = state({
      filters: { hiddenEdgeKinds: ["page-link", "fk"], tableVisibility: "all" },
    });
    expect(decodeGraphViewState(encodeGraphViewState(shuffled))).toEqual(decoded);
  });

  it("rounds the viewport on encode (two decimals for x/y, three for zoom)", () => {
    const next = state({ viewport: { x: 1.23456, y: -2.34567, zoom: 0.87654321 } });
    const encoded = encodeGraphViewState(next);
    expect(encoded).toContain('"v":[1.23,-2.35,0.877]');
    expect(decodeGraphViewState(encoded).viewport).toEqual({ x: 1.23, y: -2.35, zoom: 0.877 });
  });

  it("is stable: decode(encode(s)) equals s and re-encoding is byte-identical", () => {
    const next = state({
      mode: "matrix",
      activeLenses: ["data", "runtime"],
      selection: "route:POST /api/todos",
      focus: ["table:todos"],
      filters: { hiddenEdgeKinds: ["fk", "relation"], tableVisibility: "used" },
      collapsed: ["table:todos"],
      viewport: { x: -300.1, y: 42.42, zoom: 1.25 },
      query: "hello world",
    });
    const once = decodeGraphViewState(encodeGraphViewState(next));
    expect(once).toEqual(next);
    expect(encodeGraphViewState(once)).toBe(encodeGraphViewState(next));
  });
});

describe("graph view state degradation", () => {
  it("degrades a hostile impact column to null instead of throwing (issue #74)", () => {
    expect(decodeGraphViewState('{"k":42}').impactColumn).toBeNull();
    expect(decodeGraphViewState('{"k":""}').impactColumn).toBeNull();
    expect(decodeGraphViewState('{"k":{"property":"dueDate"}}').impactColumn).toBeNull();
    expect(decodeGraphViewState('{"k":["dueDate"]}').impactColumn).toBeNull();
    // A column property is not a node id: knownNodeIds never drops a well-formed one.
    expect(decodeGraphViewState('{"k":"dueDate"}', new Set()).impactColumn).toBe("dueDate");
  });

  it("drops unknown lens ids against the registry", () => {
    const decoded = decodeGraphViewState('{"l":["contract","nope","data","contract"]}');
    expect(decoded.activeLenses).toEqual(["contract", "data"]);
  });

  it("drops selection, isolatedNode, focus and collapsed ids missing from knownNodeIds", () => {
    const known = new Set(["table:todos", "page:/"]);
    const raw = encodeGraphViewState(
      state({
        selection: "table:gone",
        isolatedNode: "table:gone",
        focus: ["table:todos", "table:gone"],
        collapsed: ["page:/", "view:stale"],
      }),
    );
    const decoded = decodeGraphViewState(raw, known);
    expect(decoded.selection).toBeNull();
    expect(decoded.isolatedNode).toBeNull();
    expect(decoded.focus).toEqual(["table:todos"]);
    expect(decoded.collapsed).toEqual(["page:/"]);
  });

  it("keeps ids that exist in knownNodeIds", () => {
    const known = new Set(["table:todos"]);
    const decoded = decodeGraphViewState(
      '{"s":"table:todos","n":"table:todos","f":["table:todos"],"c":["table:todos"]}',
      known,
    );
    expect(decoded.selection).toBe("table:todos");
    expect(decoded.isolatedNode).toBe("table:todos");
    expect(decoded.focus).toEqual(["table:todos"]);
    expect(decoded.collapsed).toEqual(["table:todos"]);
  });

  it("degrades malformed JSON to defaults without throwing", () => {
    for (const raw of ["{", "{oops", "[]", "null", "42", '"text"', "true", ""]) {
      expect(decodeGraphViewState(raw)).toEqual(DEFAULT_GRAPH_VIEW_STATE);
    }
  });

  it("degrades wrong-typed and hostile fields to defaults without throwing", () => {
    const hostile = JSON.stringify({
      m: 7,
      l: "contract",
      a: "protected",
      s: { id: "x" },
      f: [1, null, ""],
      h: ["bogus", 3],
      t: "wide",
      c: { a: true },
      v: [1, 2],
      q: 9,
      __proto__: { polluted: true },
    });
    expect(decodeGraphViewState(hostile)).toEqual(DEFAULT_GRAPH_VIEW_STATE);
    expect(decodeGraphViewState('{"s":""}').selection).toBeNull();
    expect(decodeGraphViewState('{"f":["","a","a"]}').focus).toEqual(["a"]);
  });

  it("rejects invalid viewports (wrong shape, non-finite, non-positive zoom)", () => {
    for (const v of [
      "[1,2]",
      "[1,2,3,4]",
      "[0,0,0]",
      "[1,2,-1]",
      '["a",2,3]',
      "[1,2]",
      "null",
      '{"x":1}',
    ]) {
      expect(decodeGraphViewState(`{"v":${v}}`).viewport).toBeNull();
    }
    expect(decodeGraphViewState('{"v":[1e308,1e308,1e308]}').viewport).toBeNull();
  });

  it("degrades oversized payloads to defaults", () => {
    expect(decodeGraphViewState("x".repeat(5000))).toEqual(DEFAULT_GRAPH_VIEW_STATE);
    const big = JSON.stringify({ q: "a".repeat(5000) });
    expect(decodeGraphViewState(big)).toEqual(DEFAULT_GRAPH_VIEW_STATE);
  });
});

describe("graph view state cluster fields (issue #62)", () => {
  it("round-trips the collapse set, the group-by choice and the drill", () => {
    const next = state({
      collapsedClusters: ["cluster:api/todos", "cluster:db"],
      groupBy: "on",
      drill: "cluster:api/todos",
    });
    const once = decodeGraphViewState(encodeGraphViewState(next));
    expect(once).toEqual(next);
    expect(encodeGraphViewState(once)).toBe(encodeGraphViewState(next));
  });

  it("omits the auto default and deduplicates the collapse ids", () => {
    expect(encodeGraphViewState(state({ groupBy: "auto" }))).toBe("");
    const encoded = encodeGraphViewState(
      state({ collapsedClusters: ["cluster:a", "cluster:a", ""], groupBy: "off" }),
    );
    expect(encoded).toBe('{"cc":["cluster:a"],"g":"off"}');
  });

  it("cluster ids survive knownNodeIds filtering: they are derived, not analysis ids", () => {
    const raw = encodeGraphViewState(
      state({ collapsedClusters: ["cluster:api/todos"], drill: "cluster:api/todos" }),
    );
    const decoded = decodeGraphViewState(raw, new Set(["table:todos"]));
    expect(decoded.collapsedClusters).toEqual(["cluster:api/todos"]);
    expect(decoded.drill).toBe("cluster:api/todos");
  });

  it("degrades hostile cluster fields to defaults", () => {
    const hostile = JSON.stringify({ cc: { a: true }, g: "sometimes", d: 42 });
    const decoded = decodeGraphViewState(hostile);
    expect(decoded.collapsedClusters).toEqual([]);
    expect(decoded.groupBy).toBe("auto");
    expect(decoded.drill).toBeNull();
  });
});

describe("edge concentration threshold (issue #64)", () => {
  it("defaults to 4 and encodes the default to nothing (a clean URL)", () => {
    expect(DEFAULT_GRAPH_VIEW_STATE.edgeConcentration).toBe(4);
    expect(encodeGraphViewState(state())).toBe("");
  });

  it("round-trips off and 8 through the compact codec", () => {
    for (const edgeConcentration of ["off", 8] as const) {
      const next = state({ edgeConcentration });
      expect(decodeGraphViewState(encodeGraphViewState(next))).toEqual(next);
    }
    expect(encodeGraphViewState(state({ edgeConcentration: "off" }))).toBe('{"e":"off"}');
    expect(encodeGraphViewState(state({ edgeConcentration: 8 }))).toBe('{"e":8}');
  });

  it("round-trips alongside every other field", () => {
    const full = state({
      mode: "matrix",
      activeLenses: ["data"],
      query: "tasks",
      edgeConcentration: "off",
    });
    expect(decodeGraphViewState(encodeGraphViewState(full))).toEqual(full);
  });

  it("degrades unknown threshold values to the default", () => {
    for (const raw of ['{"e":5}', '{"e":"4"}', '{"e":null}', '{"e":{}}', '{"e":true}']) {
      expect(decodeGraphViewState(raw).edgeConcentration).toBe(4);
    }
  });

  it("the E shortcut cycles the chip order off -> 4 -> 8 -> off", () => {
    expect(cycleEdgeConcentration("off")).toBe(4);
    expect(cycleEdgeConcentration(4)).toBe(8);
    expect(cycleEdgeConcentration(8)).toBe("off");
  });
});

describe("bridges lens toggle (issue #65)", () => {
  it("defaults to enabled and omits the default from the URL", () => {
    expect(DEFAULT_GRAPH_VIEW_STATE.bridges).toBe(true);
    expect(encodeGraphViewState(state({ bridges: true }))).toBe("");
    expect(encodeGraphViewState(state({ bridges: false }))).toBe('{"b":false}');
  });

  it("round-trips the toggle off and back on", () => {
    const off = state({ bridges: false, query: "todos" });
    const decoded = decodeGraphViewState(encodeGraphViewState(off));
    expect(decoded).toEqual(off);
    expect(decodeGraphViewState(encodeGraphViewState(state({ bridges: true })))).toEqual(
      DEFAULT_GRAPH_VIEW_STATE,
    );
  });

  it("degrades hostile bridge values to the default (on)", () => {
    for (const raw of ['{"b":true}', '{"b":0}', '{"b":"false"}', '{"b":null}', '{"b":{}}']) {
      expect(decodeGraphViewState(raw).bridges).toBe(true);
    }
    expect(decodeGraphViewState('{"b":false}').bridges).toBe(false);
  });
});
