// Static-render tests for the on-demand rich card (issue #188): every node kind surfaces the
// facts the acceptance criteria name — the full table column list with markers, the page
// wireframe, route permission/input/tables/elevation/unknown, view access/base tables and the
// workflow steps. ide/ ships no jsdom, so the card is rendered to a string like the other
// presentational tests.

import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PagePreview } from "@facilis.dev/analyze";
import { initI18n, setLocale, t } from "@/i18n";
import type { TableDetails } from "@/facilis/graph-details";
import type {
  PageGraphData,
  ProjectGraphNode,
  ProjectGraphNodeData,
  RouteGraphData,
  TableGraphData,
  ViewGraphData,
  WorkflowGraphData,
} from "@/facilis/graph-model";
import { ProjectGraphRichCard } from "./ProjectGraphRichCard";

const SOURCE = { file: "db/schema.ts", line: 1 };

function nodeOf(kind: string, label: string, data: ProjectGraphNodeData): ProjectGraphNode {
  return {
    id: kind + ":" + label,
    kind: data.kind,
    label,
    sourceFile: null,
    position: { x: 0, y: 0 },
    data,
    matched: true,
    collapsed: false,
  };
}

function renderCard(
  node: ProjectGraphNode,
  details: Parameters<typeof ProjectGraphRichCard>[0]["details"] = null,
) {
  return renderToStaticMarkup(
    <ProjectGraphRichCard
      node={node}
      details={details}
      nodeLabel={(id) => id}
      onSelectNode={vi.fn()}
      onClose={vi.fn()}
      layout="anchored"
      cardRef={createRef<HTMLDivElement>()}
    />,
  );
}

const page: PageGraphData = {
  kind: "page",
  pagePath: "src/pages/todos.tsx",
  pageKind: "page",
  callCount: 1,
  routePaths: ["/todos"],
  preview: {
    routePaths: ["/todos"],
    truncated: false,
    nodes: [
      {
        id: "p0",
        parentId: null,
        name: "Page",
        kind: "component",
        file: null,
        source: SOURCE,
        dynamic: false,
      },
    ],
  } satisfies PagePreview,
};

const route: RouteGraphData = {
  kind: "route",
  method: "POST",
  path: "/api/todos",
  permission: ["todos:write"],
  wrapper: "valid",
  description: "Creates a todo.",
  input: { body: true, form: false, query: true, params: false },
  pathParams: [],
  dbTables: ["todos"],
  elevations: [],
  unknown: true,
};

const table: TableGraphData = {
  kind: "table",
  table: "todos",
  columns: [
    { property: "id", name: "id", type: "text", markers: ["primaryKey", "notNull"] },
    { property: "title", name: "title", type: "text", markers: ["unique"] },
  ],
  rlsEnabled: true,
  framework: false,
  scope: { column: "owner_id", kind: "owner" },
  policies: [],
  unknown: false,
};

const tableDetails: TableDetails = {
  source: SOURCE,
  columns: [
    {
      property: "id",
      name: "id",
      type: "text",
      notNull: true,
      primaryKey: true,
      unique: true,
      default: { kind: "now", value: null },
      source: SOURCE,
    },
    {
      property: "ownerId",
      name: "owner_id",
      type: "text",
      notNull: false,
      primaryKey: false,
      unique: false,
      default: null,
      source: SOURCE,
    },
    {
      property: "title",
      name: "title",
      type: "text",
      notNull: false,
      primaryKey: false,
      unique: false,
      default: null,
      source: SOURCE,
    },
  ],
  policies: [{ name: "todos_owner", command: "ALL", restrictive: false }],
  foreignKeys: [
    {
      columns: ["owner_id"],
      targetTable: "users",
      targetColumns: ["id"],
      onDelete: null,
      onUpdate: null,
    },
  ],
  relations: [],
};

const view: ViewGraphData = {
  kind: "view",
  view: "active_todos",
  tables: ["todos", "projects"],
  permission: "todos:read",
  access: "definer",
  unknown: false,
  usedByRoutes: [{ id: "route:GET /api/todos", label: "GET /api/todos" }],
};

const workflow: WorkflowGraphData = {
  kind: "workflow",
  name: "purge",
  steps: [
    { index: 0, kind: "job", name: "purge-todos", permission: null, onRejectStep: null },
    {
      index: 1,
      kind: "approval",
      name: "workflows.purge.approval",
      permission: "tasks:decide",
      onRejectStep: 2,
    },
  ],
  unknown: false,
};

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphRichCard", () => {
  it("renders the page path, route paths, wireframe and API calls", () => {
    const html = renderCard(nodeOf("page", "src/pages/todos.tsx", page), {
      kind: "page",
      page: {
        source: SOURCE,
        calls: [
          {
            expression: "api.todos.list()",
            matchedRouteIds: ["route:GET /api/todos"],
            source: SOURCE,
          },
        ],
      },
    });
    expect(html).toContain("src/pages/todos.tsx");
    expect(html).toContain("/todos");
    expect(html).toContain("project-graph-page-sketch");
    expect(html).toContain("api.todos.list()");
    expect(html).toContain("route:GET /api/todos");
  });

  it("renders route permission, description, input chips, dbTables, elevation and unknown", () => {
    const html = renderCard(nodeOf("route", "POST /api/todos", route), {
      kind: "route",
      route: {
        source: SOURCE,
        dbColumns: [],
        crossSite: null,
        rawSql: null,
        handlerBodyRead: true,
        handlerFormRead: false,
        relations: { used: [], unresolved: 1, rawSql: 0, opaque: false },
        elevations: [{ kind: "sudo", operation: "db.delete", tables: ["todos"], source: SOURCE }],
      },
    });
    expect(html).toContain(t("projectGraph.permission", { permission: "todos:write" }));
    expect(html).toContain("Creates a todo.");
    expect(html).toContain(t("projectGraph.input.body"));
    expect(html).toContain(t("projectGraph.input.query"));
    expect(html).toContain("todos");
    expect(html).toContain(t("projectGraph.elevation.sudo"));
    expect(html).toContain(t("projectGraph.unknown"));
    expect(html).toContain(t("projectGraph.flag.unresolved", { count: 1 }));
  });

  it("renders the FULL table column list with type and PK/NN/UQ/DEF/FK markers", () => {
    const html = renderCard(nodeOf("table", "todos", table), {
      kind: "table",
      table: tableDetails,
    });
    for (const name of ["id", "owner_id", "title"]) expect(html).toContain(name);
    expect(html).toContain("text");
    expect(html).toContain(t("projectGraph.surface.card.marker.pk"));
    expect(html).toContain(t("projectGraph.surface.card.marker.nn"));
    expect(html).toContain(t("projectGraph.surface.card.marker.uq"));
    expect(html).toContain(t("projectGraph.surface.card.marker.def"));
    expect(html).toContain(t("projectGraph.surface.card.marker.fk"));
    expect(html).toContain(t("projectGraph.scope", { column: "owner_id", kind: "owner" }));
    expect(html.match(/project-graph-rich-card-column/g)).toHaveLength(3);
  });

  it("renders view access and base tables", () => {
    const html = renderCard(nodeOf("view", "active_todos", view));
    expect(html).toContain(t("projectGraph.access.definer"));
    expect(html).toContain("todos:read");
    expect(html).toContain(t("projectGraph.baseTables"));
    expect(html).toContain("projects");
  });

  it("renders the workflow steps and their permissions", () => {
    const html = renderCard(nodeOf("workflow", "purge", workflow), {
      kind: "workflow",
      workflow: { source: SOURCE, tables: ["todos"], unknownJobs: [], unknown: false },
    });
    expect(html).toContain("purge-todos");
    expect(html).toContain("workflows.purge.approval");
    expect(html).toContain(t("projectGraph.workflow.permission", { permission: "tasks:decide" }));
  });

  it("surfaces missing analysis facts instead of inventing them", () => {
    const html = renderCard(nodeOf("table", "todos", table));
    expect(html).toContain(t("projectGraph.surface.card.noDetails"));
  });

  it("has an accessible dialog label and a close button", () => {
    const html = renderCard(nodeOf("table", "todos", table));
    expect(html).toContain('role="dialog"');
    expect(html).toContain(t("projectGraph.surface.card.label"));
    expect(html).toContain(t("projectGraph.surface.card.close"));
  });
});
