import { describe, expect, it } from "vitest";
import { GRAPH_EDGE_KINDS } from "./graph-types";
import {
  DEFAULT_GRAPH_VIEW_STATE,
  GRAPH_LENS_IDS,
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
      isolatedNode: "table:予定表",
      selection: "table:予定表",
      focus: ["page:/設定", "route:GET /api/検索", "table:café"],
      filters: { hiddenEdgeKinds: [...GRAPH_EDGE_KINDS], tableVisibility: "project" },
      collapsed: ["table:予定表", "view:active_todos"],
      viewport: { x: 120.25, y: -40.5, zoom: 0.875 },
      query: "検索 todos 🎉 café",
      matrixSort: "degree",
    });
    expect(decodeGraphViewState(encodeGraphViewState(full))).toEqual(full);
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

  it("encodes isolation under i and omits it when empty", () => {
    expect(encodeGraphViewState(state({ isolatedEdgeKinds: ["relation", "fk"] }))).toBe(
      '{"i":["fk","relation"]}',
    );
    expect(encodeGraphViewState(state({ isolatedEdgeKinds: [] }))).toBe("");
    expect(decodeGraphViewState('{"i":["bogus",3]}').isolatedEdgeKinds).toEqual([]);
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
