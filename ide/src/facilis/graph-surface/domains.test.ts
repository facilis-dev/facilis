// Domain derivation rules (issue #184): file-location groups for pages/routes, reference votes
// for schema objects and workflows, framework tables apart, deterministic ordering.
import { describe, expect, it } from "vitest";
import type { ProjectGraphEdge, ProjectGraphNode } from "../graph-types.ts";
import { CORE_DOMAIN, FRAMEWORK_DOMAIN, deriveDomains, domainIndex } from "./domains.ts";

function page(id: string, sourceFile: string | null): ProjectGraphNode {
  return {
    id,
    kind: "page",
    label: id,
    sourceFile,
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
    data: {
      kind: "page",
      pagePath: "/" + id,
      pageKind: "page",
      callCount: 0,
      routePaths: [],
      preview: null,
    },
  };
}

function route(id: string, sourceFile: string | null, path: string): ProjectGraphNode {
  return {
    id,
    kind: "route",
    label: id,
    sourceFile,
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
    data: {
      kind: "route",
      method: "GET",
      path,
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
}

function table(id: string, framework = false): ProjectGraphNode {
  return {
    id,
    kind: "table",
    label: id,
    sourceFile: "db/schema.ts",
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
    data: {
      kind: "table",
      table: id,
      columns: [],
      rlsEnabled: true,
      framework,
      scope: null,
      policies: [],
      unknown: false,
    },
  };
}

function view(id: string): ProjectGraphNode {
  return {
    id,
    kind: "view",
    label: id,
    sourceFile: "db/views/" + id + ".ts",
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
    data: {
      kind: "view",
      view: id,
      tables: [],
      permission: null,
      access: "invoker",
      unknown: false,
      usedByRoutes: [],
    },
  };
}

function workflow(id: string): ProjectGraphNode {
  return {
    id,
    kind: "workflow",
    label: id,
    sourceFile: "workflows/" + id + ".ts",
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
    data: { kind: "workflow", name: id, steps: [], unknown: false },
  };
}

function edge(kind: ProjectGraphEdge["kind"], source: string, target: string): ProjectGraphEdge {
  return { id: kind + ":" + source + "->" + target, kind, source, target, label: null };
}

const names = (nodes: readonly ProjectGraphNode[], edges: readonly ProjectGraphEdge[]) =>
  deriveDomains(nodes, edges).map((domain) => domain.name);

describe("deriveDomains", () => {
  it("groups pages by the directory segment under src/pages, with core as fallback", () => {
    const nodes = [
      page("admin-users", "src/pages/admin/users.tsx"),
      page("admin-deep", "src/pages/admin/settings/deep.tsx"),
      page("shop", "src/pages/shop/index.tsx"),
      page("home", "src/pages/index.tsx"),
      page("orphan", null),
    ];
    const domains = deriveDomains(nodes, []);
    expect(domains.map((d) => d.name)).toEqual(["admin", "core", "shop"]);
    expect(domains[0]?.nodeIds).toEqual(["admin-deep", "admin-users"]);
    expect(domains[1]?.nodeIds).toEqual(["home", "orphan"]);
  });

  it("groups routes by server/routes directory, then path segment, then core", () => {
    const nodes = [
      route("r-admin", "server/routes/admin/users.get.ts", "/admin/users"),
      route("r-api", "server/routes/todos.get.ts", "/api/todos"),
      route("r-root", "server/routes/index.get.ts", "/"),
      route("r-nofile", null, "/billing/invoices"),
    ];
    const domains = deriveDomains(nodes, []);
    expect(domains.map((d) => d.name)).toEqual(["admin", "api", "billing", "core"]);
  });

  it("assigns tables to the group with the most incoming route references", () => {
    const nodes = [
      route("r1", "server/routes/admin/a.get.ts", "/admin/a"),
      route("r2", "server/routes/admin/b.get.ts", "/admin/b"),
      route("r3", "server/routes/shop/c.get.ts", "/shop/c"),
      table("todos"),
    ];
    const edges = [
      edge("route-table", "r1", "todos"),
      edge("route-table", "r2", "todos"),
      edge("route-table", "r3", "todos"),
    ];
    expect(deriveDomains(nodes, edges).find((d) => d.name === "admin")?.nodeIds).toContain("todos");
  });

  it("breaks reference ties lexicographically and ignores edge order", () => {
    const nodes = [
      route("r-shop", "server/routes/shop/a.get.ts", "/shop/a"),
      route("r-admin", "server/routes/admin/b.get.ts", "/admin/b"),
      table("shared"),
    ];
    const edges = [
      edge("route-table", "r-shop", "shared"),
      edge("route-table", "r-admin", "shared"),
    ];
    const forward = deriveDomains(nodes, edges);
    const reversed = deriveDomains([...nodes].reverse(), [...edges].reverse());
    expect(forward).toEqual(reversed);
    expect(forward.find((d) => d.name === "admin")?.nodeIds).toContain("shared");
    expect(forward.find((d) => d.name === "shop")?.nodeIds ?? []).not.toContain("shared");
  });

  it("counts route-view references for views and leaves unreferenced nodes in core", () => {
    const nodes = [
      route("r1", "server/routes/admin/a.get.ts", "/admin/a"),
      view("active_users"),
      table("untouched"),
      workflow("nightly"),
    ];
    const domains = deriveDomains(nodes, [edge("route-view", "r1", "active_users")]);
    expect(domains.find((d) => d.name === "admin")?.nodeIds).toEqual(["active_users", "r1"]);
    expect(domains.find((d) => d.name === CORE_DOMAIN)?.nodeIds).toEqual(["nightly", "untouched"]);
  });

  it("puts framework tables in their own group even when referenced", () => {
    const nodes = [
      route("r1", "server/routes/admin/a.get.ts", "/admin/a"),
      table("sessions", true),
    ];
    const domains = deriveDomains(nodes, [edge("route-table", "r1", "sessions")]);
    expect(domains.find((d) => d.name === FRAMEWORK_DOMAIN)?.nodeIds).toEqual(["sessions"]);
    expect(domains.find((d) => d.name === "admin")?.nodeIds).toEqual(["r1"]);
  });

  it("does not let page-route votes move a route out of its file group", () => {
    const nodes = [
      page("p", "src/pages/shop/index.tsx"),
      route("r", "server/routes/admin/a.get.ts", "/admin/a"),
    ];
    const domains = deriveDomains(nodes, [edge("page-route", "p", "r")]);
    expect(domains.find((d) => d.name === "admin")?.nodeIds).toEqual(["r"]);
    expect(domains.find((d) => d.name === "shop")?.nodeIds).toEqual(["p"]);
  });

  it("returns domains sorted by name with sorted members, whatever the input order", () => {
    const nodes = [
      page("p2", "src/pages/zeta/b.tsx"),
      table("t1"),
      page("p1", "src/pages/alpha/a.tsx"),
      route("r1", "server/routes/core/x.get.ts", "/core/x"),
    ];
    const a = deriveDomains(nodes, []);
    const b = deriveDomains([...nodes].reverse(), []);
    expect(a).toEqual(b);
    expect(a.map((d) => d.name)).toEqual(["alpha", "core", "zeta"]);
    expect(names(nodes, [])).toEqual(["alpha", "core", "zeta"]);
  });

  it("indexes every node exactly once", () => {
    const nodes = [page("p", "src/pages/admin/x.tsx"), table("t"), workflow("w")];
    const index = domainIndex(deriveDomains(nodes, []));
    expect(index.size).toBe(3);
    expect(index.get("p")).toBe("admin");
    expect(index.get("t")).toBe(CORE_DOMAIN);
    expect(index.get("w")).toBe(CORE_DOMAIN);
  });
});
