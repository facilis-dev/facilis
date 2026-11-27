// The changes lens's fact mapping (D-225, Q19): paths become node marks, never placed nodes
// and never a write. Pure inputs, so the modified/added/deleted mapping, the ribbons and the
// clean/no-repo states are unit-testable without a repository.

import { beforeEach, describe, expect, it } from "vitest";
import type { WorktreeSnapshot } from "@/ai/git-checkpoint";
import { initI18n, setLocale } from "@/i18n";
import type { ProjectGraphView } from "../graph-model";
import { buildChangesLensState } from "./changes-lens.ts";
import { surfaceLayoutKey } from "./positions.ts";

const STATS = {
  pages: 1,
  routes: 2,
  tables: 2,
  views: 0,
  workflows: 0,
  edges: 0,
  hiddenEdges: 0,
  hiddenNodes: 0,
  matches: 0,
  unknownNodes: 0,
  pageLinks: 0,
  elevatedEdges: 0,
};

function routeNode(method: "GET" | "POST", path: string, sourceFile: string) {
  return {
    id: "route:" + method + " " + path,
    kind: "route" as const,
    label: method + " " + path,
    sourceFile,
    position: { x: 1, y: 2 },
    matched: true,
    collapsed: false,
    data: {
      kind: "route" as const,
      method,
      path,
      permission: [],
      wrapper: "valid" as const,
      description: null,
      input: { body: false, form: false, query: false, params: false },
      pathParams: [],
      dbTables: [],
      elevations: [],
      unknown: false,
    },
  };
}

function tableNode(table: string, sourceFile: string) {
  return {
    id: "table:" + table,
    kind: "table" as const,
    label: table,
    sourceFile,
    position: { x: 3, y: 4 },
    matched: true,
    collapsed: false,
    data: {
      kind: "table" as const,
      table,
      columns: [],
      rlsEnabled: true,
      scope: null,
      policies: [],
      framework: false,
      unknown: false,
    },
  };
}

function pageNode(path: string) {
  return {
    id: "page:" + path,
    kind: "page" as const,
    label: path,
    sourceFile: path,
    position: { x: 5, y: 6 },
    matched: true,
    collapsed: false,
    data: {
      kind: "page" as const,
      pagePath: path,
      pageKind: "page" as const,
      callCount: 0,
      routePaths: [],
      preview: null,
    },
  };
}

const VIEW: ProjectGraphView = {
  nodes: [
    routeNode("GET", "/api/todos", "server/routes/api/todos.ts"),
    tableNode("todos", "db/schema.ts"),
    tableNode("projects", "db/schema.ts"),
    pageNode("src/pages/about.tsx"),
  ],
  edges: [],
  stats: STATS,
};

const SNAPSHOT: WorktreeSnapshot = {
  base: "0123456789abcdef",
  changes: [
    { path: "server/routes/api/todos.ts", letter: "M" },
    { path: "src/pages/about.tsx", letter: "A" },
    { path: "db/schema.ts", letter: "D" },
    { path: "README.md", letter: "M" },
  ],
  failure: null,
};

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("changes lens state", () => {
  it("marks exactly the nodes that own a changed file, never places the file-only change", () => {
    const state = buildChangesLensState(SNAPSHOT, VIEW);
    expect(state.facts.map((fact) => [fact.nodeId, fact.code])).toEqual([
      ["route:GET /api/todos", "state.fileModified"],
      ["page:src/pages/about.tsx", "state.fileAdded"],
      ["table:todos", "state.fileDeleted"],
      ["table:projects", "state.fileDeleted"],
      ["README.md", "state.fileModified"],
    ]);
    expect(state.badges.get("route:GET /api/todos")?.text).toBe("M");
    expect(state.badges.get("table:todos")?.colorToken).toBe("--destructive");
    expect(state.totals).toMatchObject({
      count: 4,
      params: { modified: 2, added: 1, deleted: 1 },
    });
    expect(state.params).toEqual({ ref: "0123456" });
    expect(state.contextKey).toBe("projectGraph.surface.state.changes.base");
    expect(state.emptyKey).toBeNull();
    expect(state.badges.has("README.md")).toBe(false);
    expect(state.badges.size).toBe(4);
  });

  it("lists a deletion with no cached node without placing a node", () => {
    const state = buildChangesLensState(
      { base: SNAPSHOT.base, changes: [{ path: "db/gone.ts", letter: "D" }], failure: null },
      VIEW,
    );
    expect(state.facts).toEqual([
      { nodeId: "db/gone.ts", code: "state.fileDeleted", params: { path: "db/gone.ts" } },
    ]);
    expect(state.badges.size).toBe(0);
    expect(state.totals).toMatchObject({ count: 1, params: { deleted: 1 } });
  });

  it("reports a clean tree as an explicit state", () => {
    const state = buildChangesLensState({ base: SNAPSHOT.base, changes: [], failure: null }, VIEW);
    expect(state.facts).toEqual([]);
    expect(state.badges.size).toBe(0);
    expect(state.totals).toMatchObject({ count: 0 });
    expect(state.emptyKey).toBe("projectGraph.surface.state.noChanges");
  });

  it("explains missing repositories, missing HEAD and failed walks", () => {
    expect(
      buildChangesLensState({ base: null, changes: [], failure: "no-repo" }, VIEW).emptyKey,
    ).toBe("projectGraph.surface.state.noRepo");
    expect(
      buildChangesLensState({ base: null, changes: [], failure: "no-head" }, VIEW).emptyKey,
    ).toBe("projectGraph.surface.state.noHead");
    expect(
      buildChangesLensState({ base: null, changes: [], failure: "error" }, VIEW).emptyKey,
    ).toBe("projectGraph.surface.state.changes.error");
  });

  it("never touches the layout fingerprint", () => {
    const key = surfaceLayoutKey(VIEW);
    buildChangesLensState(SNAPSHOT, VIEW);
    expect(surfaceLayoutKey(VIEW)).toBe(key);
    expect(VIEW.nodes.map((node) => node.position)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
  });
});
