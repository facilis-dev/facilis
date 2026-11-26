// The accessible node list builder (issue #182): grouping, ordering, per-kind hooks and the
// visible-set contract. Pure functions only, so the canvas component stays a thin mapper.
import { describe, expect, it } from "vitest";
import type { ProjectGraphNode } from "../graph-types.ts";
import type { GraphDomain } from "./domains.ts";
import { A11Y_NODE_TEST_IDS, buildA11yNodeGroups } from "./a11y-nodes.ts";

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
      return {
        ...base,
        data: { kind, name: label, steps: [], unknown: false },
      };
  }
}

const domains: readonly GraphDomain[] = [
  { name: "admin", nodeIds: ["page:admin", "route:admin", "table:users", "view:admins"] },
  { name: "shop", nodeIds: ["page:shop", "workflow:checkout"] },
];

describe("buildA11yNodeGroups", () => {
  it("groups the overview by domain in the canvas order", () => {
    const nodes = [
      node("workflow", "workflow:checkout"),
      node("table", "table:users"),
      node("page", "page:shop"),
      node("page", "page:admin"),
      node("view", "view:admins"),
      node("route", "route:admin"),
    ];
    const groups = buildA11yNodeGroups(nodes, domains, null);
    expect(groups.map((group) => group.label)).toEqual(["admin", "shop"]);
    expect(groups.map((group) => group.kind)).toEqual(["domain", "domain"]);
    expect(groups[0]?.nodes.map((entry) => entry.id)).toEqual([
      "page:admin",
      "route:admin",
      "table:users",
      "view:admins",
    ]);
    expect(groups[1]?.nodes.map((entry) => entry.id)).toEqual(["page:shop", "workflow:checkout"]);
  });

  it("sorts a group by kind order, then label, so the list is stable", () => {
    const shuffled = [node("table", "table:z", "z"), node("table", "table:a", "a")];
    const groups = buildA11yNodeGroups(
      shuffled,
      [{ name: "core", nodeIds: ["table:z", "table:a"] }],
      null,
    );
    expect(groups[0]?.nodes.map((entry) => entry.label)).toEqual(["a", "z"]);
  });

  it("drills into one domain and groups it by lane, merging tables and views in data", () => {
    const nodes = [
      node("page", "page:admin"),
      node("route", "route:admin"),
      node("table", "table:users"),
      node("view", "view:admins"),
      node("page", "page:shop"),
    ];
    const groups = buildA11yNodeGroups(nodes, domains, "admin");
    expect(groups.map((group) => group.label)).toEqual(["page", "route", "data"]);
    expect(groups.map((group) => group.kind)).toEqual(["lane", "lane", "lane"]);
    expect(groups[0]?.nodes.map((entry) => entry.id)).toEqual(["page:admin"]);
    expect(groups[2]?.nodes.map((entry) => entry.id)).toEqual(["table:users", "view:admins"]);
  });

  it("excludes nodes hidden from the view model (table visibility) even if a domain still lists them", () => {
    const visible = [node("page", "page:admin")];
    const groups = buildA11yNodeGroups(visible, domains, null);
    expect(groups.flatMap((group) => group.nodes.map((entry) => entry.id))).toEqual(["page:admin"]);
    expect(groups.find((group) => group.label === "shop")).toBeUndefined();
  });

  it("returns no groups for an empty visible graph", () => {
    expect(buildA11yNodeGroups([], [], null)).toEqual([]);
    expect(buildA11yNodeGroups([], domains, "admin")).toEqual([]);
  });

  it("keeps the legacy test ids one per kind", () => {
    expect(A11Y_NODE_TEST_IDS).toEqual({
      page: "project-graph-page",
      route: "project-graph-route",
      table: "project-graph-table",
      view: "project-graph-view",
      workflow: "project-graph-workflow",
    });
  });
});
