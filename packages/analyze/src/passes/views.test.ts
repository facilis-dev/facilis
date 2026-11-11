import { describe, expect, it } from "vitest";

import { analyzeProject } from "../analyze.ts";
import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { buildViewFacts } from "./views.ts";

const HEADER =
  'import { sql } from "drizzle-orm";\n' +
  'import { defineView } from "@facilis.dev/db";\n' +
  'import { boolean, text } from "drizzle-orm/pg-core";\n';

const QUERY_A = "sql`select id, done from todos where not done`";
const QUERY_B = "sql`select count(*) as total from todos`";
const QUERY_C = "sql`select 1`";
const QUERY_D = "sql`select id from todos`";

function viewsOf(files: Record<string, string>) {
  const graph = createModuleGraph({
    files: new Map(Object.entries(files)),
    parser: createOxcParser(),
  });
  return buildViewFacts(graph);
}

describe("defineView facts (D-157)", () => {
  it("reads a definer view with its permission and base tables", () => {
    const scan = viewsOf({
      "db/views/active-todos.ts":
        HEADER +
        "export const activeTodos = defineView({\n" +
        '  name: "active_todos",\n' +
        '  columns: { id: text("id"), done: boolean("done") },\n' +
        "  query: " +
        QUERY_A +
        ",\n" +
        '  tables: ["todos"],\n' +
        '  permission: "todos:read",\n' +
        "});\n",
    });
    expect(scan.diagnostics).toEqual([]);
    expect(scan.views).toHaveLength(1);
    expect(scan.views[0]).toMatchObject({
      name: "active_todos",
      binding: "activeTodos",
      tables: ["todos"],
      permission: "todos:read",
      access: "definer",
      unknown: [],
    });
    expect(scan.views[0]?.source.file).toBe("db/views/active-todos.ts");
  });

  it("keeps the invoker behaviour when no permission is declared", () => {
    const scan = viewsOf({
      "db/views/todo-count.ts":
        HEADER +
        "export const todoCount = defineView({\n" +
        '  name: "todo_count",\n' +
        '  columns: { total: text("total") },\n' +
        "  query: " +
        QUERY_B +
        ",\n" +
        "});\n",
    });
    expect(scan.views[0]).toMatchObject({ permission: null, access: "invoker", tables: [] });
  });

  it("records an unreadable declaration as an explicit unknown", () => {
    const scan = viewsOf({
      "db/views/broken.ts":
        HEADER +
        "const name = viewName();\n" +
        "export const broken = defineView({\n" +
        "  name,\n" +
        '  columns: { id: text("id") },\n' +
        "  query: " +
        QUERY_C +
        ",\n" +
        "});\n",
    });
    expect(scan.views[0]?.name).toBe("broken");
    expect(scan.views[0]?.unknown.length).toBeGreaterThan(0);
    expect(scan.diagnostics.map((entry) => entry.code)).toEqual(["view-static"]);
    expect(scan.diagnostics[0]?.severity).toBe("error");
  });

  it("ignores files outside db/views and non-defineView declarations", () => {
    const scan = viewsOf({
      "db/schema.ts":
        'import { pgTable, uuid } from "drizzle-orm/pg-core";\n' +
        'export const todos = pgTable("todos", { id: uuid("id").primaryKey() });\n',
      "db/views/not-a-view.ts":
        'import { sql } from "drizzle-orm";\nexport const x = ' + QUERY_C + ";\n",
    });
    expect(scan.views).toEqual([]);
    expect(scan.diagnostics).toEqual([]);
  });

  it("exposes views in the analysis and as project-graph nodes", () => {
    const analysis = analyzeProject({
      files: new Map([
        [
          "db/views/active-todos.ts",
          HEADER +
            "export const activeTodos = defineView({\n" +
            '  name: "active_todos",\n' +
            '  columns: { id: text("id") },\n' +
            "  query: " +
            QUERY_D +
            ",\n" +
            "});\n",
        ],
      ]),
      parser: createOxcParser(),
    });
    expect(analysis.views.map((view) => view.name)).toEqual(["active_todos"]);
    expect(analysis.graph.nodes).toMatchObject([
      { id: "view:active_todos", kind: "view", label: "active_todos" },
    ]);
    expect(analysis.graph.edges).toEqual([]);
  });

  it("feeds the project graph: a route that declares a view gets a route-view edge", () => {
    const analysis = analyzeProject({
      files: new Map([
        [
          "db/views/active-todos.ts",
          HEADER +
            "export const activeTodos = defineView({\n" +
            '  name: "active_todos",\n' +
            '  columns: { id: text("id") },\n' +
            "  query: " +
            QUERY_A +
            ",\n" +
            '  tables: ["todos"],\n' +
            '  permission: "todos:read",\n' +
            "});\n",
        ],
        [
          "server/routes/api/active-todos.get.ts",
          'import { defineAuthorizedHandler } from "@facilis.dev/core";\n' +
            'import { activeTodos } from "~/db/views/active-todos";\n' +
            "export default defineAuthorizedHandler(\n" +
            '  { permission: [], dbTables: ["active_todos"] },\n' +
            "  async (_event, { db }) => db.select().from(activeTodos),\n" +
            ");\n",
        ],
      ]),
      parser: createOxcParser(),
    });
    expect(
      analysis.graph.nodes.find((node) => node.id === "view:active_todos")?.data,
    ).toMatchObject({
      kind: "view",
      view: "active_todos",
      tables: ["todos"],
      permission: "todos:read",
      access: "definer",
    });
    expect(analysis.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "route-view",
          source: "route:GET /api/active-todos",
          target: "view:active_todos",
          label: "dbTables",
        }),
      ]),
    );
  });
});
