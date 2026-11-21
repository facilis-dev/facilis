import { describe, expect, it } from "vitest";
import { GRAPH_EDGE_KINDS } from "./graph-types";
import {
  MAX_ACTIVE_LENSES,
  activateLens,
  countEdgeKinds,
  isolateEdgeKind,
  lensRole,
} from "./graph-lens-state";

describe("activateLens", () => {
  it("activates the first lens as dominant", () => {
    expect(activateLens([], "contract")).toEqual({ lenses: ["contract"], refused: false });
  });

  it("demotes the previous dominant when a second lens activates", () => {
    expect(activateLens(["contract"], "data")).toEqual({
      lenses: ["data", "contract"],
      refused: false,
    });
  });

  it("activates a third lens as a second secondary (epic rule 3, F.3)", () => {
    expect(activateLens(["data", "contract"], "runtime")).toEqual({
      lenses: ["runtime", "data", "contract"],
      refused: false,
    });
  });

  it("refuses a fourth lens without changing the state", () => {
    const lenses = ["data", "contract", "runtime"] as const;
    expect(activateLens(lenses, "agent")).toEqual({ lenses, refused: true });
    expect(MAX_ACTIVE_LENSES).toBe(3);
  });

  it("removes an active lens and promotes the next when the dominant goes", () => {
    expect(activateLens(["data", "contract"], "data")).toEqual({
      lenses: ["contract"],
      refused: false,
    });
    expect(activateLens(["data", "contract"], "contract")).toEqual({
      lenses: ["data"],
      refused: false,
    });
    expect(activateLens(["data"], "data")).toEqual({ lenses: [], refused: false });
  });

  it("frees a slot for a new lens after one is removed", () => {
    const two = activateLens(["data", "contract", "runtime"], "contract").lenses;
    expect(activateLens(two, "agent")).toEqual({
      lenses: ["agent", "data", "runtime"],
      refused: false,
    });
  });
});

describe("lensRole", () => {
  it("names the first lens dominant, the others secondary, inactive lenses null", () => {
    expect(lensRole(["data", "contract"], "data")).toBe("dominant");
    expect(lensRole(["data", "contract"], "contract")).toBe("secondary");
    expect(lensRole(["data", "contract", "runtime"], "runtime")).toBe("secondary");
    expect(lensRole(["data", "contract"], "agent")).toBeNull();
    expect(lensRole([], "data")).toBeNull();
  });
});

describe("isolateEdgeKind", () => {
  it("a plain click isolates one kind, replacing any previous set", () => {
    expect(isolateEdgeKind([], "fk", false)).toEqual(["fk"]);
    expect(isolateEdgeKind(["relation", "fk"], "fk", false)).toEqual(["fk"]);
  });

  it("a plain click on the sole isolated kind clears the isolation", () => {
    expect(isolateEdgeKind(["fk"], "fk", false)).toEqual([]);
  });

  it("shift-click adds to and removes from the set without touching the others", () => {
    expect(isolateEdgeKind(["fk"], "relation", true)).toEqual(["fk", "relation"]);
    expect(isolateEdgeKind(["fk", "relation"], "fk", true)).toEqual(["relation"]);
    expect(isolateEdgeKind([], "fk", true)).toEqual(["fk"]);
  });
});

describe("countEdgeKinds", () => {
  it("starts every kind at zero and counts the analysis edges", () => {
    const counts = countEdgeKinds([{ kind: "fk" }, { kind: "fk" }, { kind: "route-table" }]);
    for (const kind of GRAPH_EDGE_KINDS) {
      expect(counts[kind]).toBe(kind === "fk" ? 2 : kind === "route-table" ? 1 : 0);
    }
  });

  it("returns all-zero counts for an empty analysis", () => {
    const counts = countEdgeKinds([]);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    expect(Object.keys(counts)).toHaveLength(GRAPH_EDGE_KINDS.length);
  });
});
