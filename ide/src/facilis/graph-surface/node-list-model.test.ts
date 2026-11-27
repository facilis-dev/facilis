// The keyboard model of the node rail (issue #213): flattening, the roving tab stop, the key
// intents and the select contract. Pure, so no DOM is needed for the rules the rail applies.
import { describe, expect, it, vi } from "vitest";
import type { ProjectGraphNode } from "../graph-types.ts";
import { buildA11yNodeGroups } from "./a11y-nodes.ts";
import type { GraphDomain } from "./domains.ts";
import {
  activeNodeOption,
  buildNodeListOptions,
  nodeListIntent,
  nodeListOptionAttributes,
  selectListNode,
} from "./node-list-model.ts";

function node(kind: ProjectGraphNode["kind"], id: string, label = id): ProjectGraphNode {
  const base = {
    id,
    kind,
    label,
    sourceFile: null,
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
  } as const;
  switch (kind) {
    case "page":
      return {
        ...base,
        data: {
          kind,
          pagePath: label,
          pageKind: "page",
          callCount: 0,
          routePaths: [],
          preview: null,
        },
      };
    case "route":
      return {
        ...base,
        data: {
          kind,
          method: "GET",
          path: label,
          permission: [],
          wrapper: "valid",
          description: null,
          input: { body: false, form: false, query: false, params: false },
          pathParams: [],
          dbTables: [],
          elevations: [],
          unknown: false,
        },
      };
    case "table":
      return {
        ...base,
        data: {
          kind,
          table: label,
          columns: [],
          rlsEnabled: true,
          framework: false,
          scope: null,
          policies: [],
          unknown: false,
        },
      };
    case "view":
      return {
        ...base,
        data: {
          kind,
          view: label,
          tables: [],
          permission: null,
          access: "invoker",
          unknown: false,
          usedByRoutes: [],
        },
      };
    case "workflow":
      return { ...base, data: { kind, name: label, steps: [], unknown: false } };
  }
}

const nodes = [
  node("page", "page:admin", "/admin"),
  node("table", "table:users", "users"),
  node("route", "route:shop", "/shop"),
];
const domains: readonly GraphDomain[] = [
  { name: "admin", nodeIds: ["page:admin", "table:users"] },
  { name: "shop", nodeIds: ["route:shop"] },
];
const groups = buildA11yNodeGroups(nodes, domains, null);
const options = buildNodeListOptions(groups);

function move(activeId: string | null, key: string): ReturnType<typeof nodeListIntent> {
  return nodeListIntent(options, activeId, { key });
}

describe("buildNodeListOptions", () => {
  it("flattens the canvas groups in order", () => {
    expect(options.map((option) => option.id)).toEqual(["page:admin", "table:users", "route:shop"]);
  });

  it("keeps the kind, label and group the rail renders", () => {
    expect(options.map((option) => [option.kind, option.label, option.groupKey])).toEqual([
      ["page", "/admin", "domain:admin"],
      ["table", "users", "domain:admin"],
      ["route", "/shop", "domain:shop"],
    ]);
  });

  it("follows the detail lanes in drill-down mode", () => {
    const detail = buildNodeListOptions(buildA11yNodeGroups(nodes, domains, "admin"));
    expect(detail.map((option) => [option.id, option.groupKey])).toEqual([
      ["page:admin", "lane:page"],
      ["table:users", "lane:data"],
    ]);
  });

  it("has no options for an empty graph", () => {
    expect(buildNodeListOptions([])).toEqual([]);
  });
});

describe("activeNodeOption", () => {
  it("is the active option and recovers to the first one when the id is gone", () => {
    expect(activeNodeOption(options, "table:users")?.id).toBe("table:users");
    expect(activeNodeOption(options, "deleted")?.id).toBe("page:admin");
    expect(activeNodeOption(options, null)?.id).toBe("page:admin");
    expect(activeNodeOption([], "page:admin")).toBeNull();
  });
});

describe("nodeListIntent", () => {
  it("moves the active option with the arrows, clamped at both ends", () => {
    expect(move("table:users", "ArrowDown")).toEqual({ kind: "active", id: "route:shop" });
    expect(move("table:users", "ArrowUp")).toEqual({ kind: "active", id: "page:admin" });
    expect(move("page:admin", "ArrowUp")).toEqual({ kind: "active", id: "page:admin" });
    expect(move("route:shop", "ArrowDown")).toEqual({ kind: "active", id: "route:shop" });
  });

  it("jumps to the ends with Home and End", () => {
    expect(move("table:users", "Home")).toEqual({ kind: "active", id: "page:admin" });
    expect(move("table:users", "End")).toEqual({ kind: "active", id: "route:shop" });
  });

  it("starts from the first option when the active id is gone", () => {
    expect(move("deleted", "ArrowDown")).toEqual({ kind: "active", id: "table:users" });
  });

  it("selects the active option on Enter or Space", () => {
    expect(move("table:users", "Enter")).toEqual({ kind: "select", id: "table:users" });
    expect(move("table:users", " ")).toEqual({ kind: "select", id: "table:users" });
    expect(move(null, "Enter")).toEqual({ kind: "select", id: "page:admin" });
  });

  it("leaves Escape to the graph's single ladder and every other key alone", () => {
    expect(move("table:users", "Escape")).toBeNull();
    expect(move("table:users", "a")).toBeNull();
    expect(move("table:users", "Tab")).toBeNull();
  });

  it("leaves modified chords to the window shortcuts", () => {
    expect(nodeListIntent(options, "table:users", { key: "ArrowDown", ctrlKey: true })).toBeNull();
    expect(nodeListIntent(options, "table:users", { key: "ArrowDown", shiftKey: true })).toBeNull();
    expect(nodeListIntent(options, "table:users", { key: "Enter", altKey: true })).toBeNull();
  });

  it("has no intent on an empty list", () => {
    expect(nodeListIntent([], null, { key: "ArrowDown" })).toBeNull();
    expect(nodeListIntent([], null, { key: "Enter" })).toBeNull();
  });
});

describe("nodeListOptionAttributes", () => {
  it("gives the list one tab stop and marks only the selected option", () => {
    const attributes = options.map((option) =>
      nodeListOptionAttributes(option.id === "table:users", option.id === "page:admin"),
    );
    expect(attributes).toEqual([
      { role: "option", "aria-selected": true, tabIndex: -1 },
      { role: "option", "aria-selected": false, tabIndex: 0 },
      { role: "option", "aria-selected": false, tabIndex: -1 },
    ]);
  });
});

describe("selectListNode", () => {
  it("selects the node and opens its domain from the overview", () => {
    const onSelectNode = vi.fn();
    const onOpenDomain = vi.fn();
    selectListNode("page:admin", "admin", null, onSelectNode, onOpenDomain);
    expect(onOpenDomain).toHaveBeenCalledWith("admin");
    expect(onSelectNode).toHaveBeenCalledWith("page:admin");
  });

  it("keeps the current domain in the detail and only selects", () => {
    const onSelectNode = vi.fn();
    const onOpenDomain = vi.fn();
    selectListNode("table:users", "admin", "admin", onSelectNode, onOpenDomain);
    expect(onOpenDomain).not.toHaveBeenCalled();
    expect(onSelectNode).toHaveBeenCalledWith("table:users");
  });

  it("selects a node with no domain without opening one", () => {
    const onSelectNode = vi.fn();
    const onOpenDomain = vi.fn();
    selectListNode("table:users", null, null, onSelectNode, onOpenDomain);
    expect(onOpenDomain).not.toHaveBeenCalled();
    expect(onSelectNode).toHaveBeenCalledWith("table:users");
  });
});
