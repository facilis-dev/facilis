import { describe, expect, it } from "vitest";

import { buildProjectGraph } from "./graph.ts";
import { fixtureInput, ref, route, view } from "../test-fixtures/graph.ts";

describe("buildProjectGraph views (D-160)", () => {
  it("adds one node per declared view with its permission, access and unknown facts", () => {
    const definer = view({
      name: "active_todos",
      permission: "todos:read",
      access: "definer",
      tables: ["todos"],
    });
    const broken = view({
      name: "broken",
      access: null,
      unknown: [
        { code: "view-static", reason: "permission not static", source: ref("db/views/broken.ts") },
      ],
    });
    const withViews = buildProjectGraph({ ...fixtureInput(), views: [definer, broken] });
    expect(withViews.nodes.find((node) => node.id === "view:active_todos")).toMatchObject({
      kind: "view",
      label: "active_todos",
      sourceFile: "db/views/active_todos.ts",
      data: {
        kind: "view",
        view: "active_todos",
        tables: ["todos"],
        permission: "todos:read",
        access: "definer",
        unknown: false,
      },
    });
    expect(withViews.nodes.find((node) => node.id === "view:broken")?.data).toMatchObject({
      kind: "view",
      access: null,
      unknown: true,
    });
  });

  it("connects a route that declares a view with a route-view edge, elevated when audited", () => {
    const routeView = route({
      method: "GET",
      path: "/api/active-todos",
      dbTables: ["active_todos"],
      elevations: [
        {
          kind: "system",
          tables: ["active_todos"],
          operation: null,
          source: ref("server/routes/api/active-todos.get.ts"),
          unknown: [],
        },
      ],
    });
    const withViews = buildProjectGraph({
      ...fixtureInput(),
      routes: [routeView],
      views: [view({ name: "active_todos", tables: ["todos"] })],
    });
    expect(withViews.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "route-view",
          source: "route:GET /api/active-todos",
          target: "view:active_todos",
          label: "dbTables",
          access: "elevated",
        }),
      ]),
    );
    expect(
      withViews.edges.some(
        (edge) => edge.kind === "route-table" && edge.target === "table:active_todos",
      ),
    ).toBe(false);
  });

  it("draws view-base edges to declared base tables and to a base view", () => {
    const withViews = buildProjectGraph({
      ...fixtureInput(),
      views: [
        view({ name: "active_todos", tables: ["todos", "projects", "missing"] }),
        view({ name: "project_counts", tables: ["projects", "active_todos"] }),
      ],
    });
    expect(withViews.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "view-base",
          source: "view:active_todos",
          target: "table:todos",
        }),
        expect.objectContaining({
          kind: "view-base",
          source: "view:active_todos",
          target: "table:projects",
        }),
        expect.objectContaining({
          kind: "view-base",
          source: "view:project_counts",
          target: "view:active_todos",
        }),
      ]),
    );
    expect(
      withViews.edges.some((edge) => edge.kind === "view-base" && edge.target === "table:missing"),
    ).toBe(false);
  });
});
