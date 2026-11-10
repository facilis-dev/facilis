// Fixtures shared by graph-model.test.ts and graph-model-layout.test.ts: the analyzer's
// GraphNode/ProjectGraph shapes, small enough to spell out. Not a test module (the name does
// not match Vitest's test glob), and not imported by the app.
import type {
  ColumnFact,
  GraphNode,
  ProjectGraph,
  RouteInputFact,
  SourceRef,
} from "@facilis/analyze";

export const ref = (file: string): SourceRef => ({ file, line: 1 });

export function column(property: string, overrides: Partial<ColumnFact> = {}): ColumnFact {
  return {
    property,
    name: property.replace(/[A-Z]/g, (char) => "_" + char.toLowerCase()),
    builder: "text",
    type: "text",
    notNull: false,
    primaryKey: false,
    unique: false,
    default: null,
    source: ref("db/schema.ts"),
    unknown: [],
    ...overrides,
  };
}

export function pageNode(path: string, callCount = 1): GraphNode {
  return {
    id: "page:" + path,
    kind: "page",
    label: path,
    sourceFile: path,
    data: { kind: "page", pagePath: path, pageKind: "page", callCount },
  };
}

export function routeNode(
  method: "GET" | "POST",
  path: string,
  overrides: Partial<{
    permission: readonly string[] | null;
    wrapper: "valid" | "invalid" | "unknown";
    input: RouteInputFact;
    description: string | null;
    unknown: boolean;
  }> = {},
): GraphNode {
  return {
    id: "route:" + method + " " + path,
    kind: "route",
    label: method + " " + path,
    sourceFile: "server/routes/api" + path + ".ts",
    data: {
      kind: "route",
      method,
      path,
      permission: overrides.permission ?? ["todos:read"],
      wrapper: overrides.wrapper ?? "valid",
      input: overrides.input ?? { body: false, form: false, query: false, params: false },
      dbTables: ["todos"],
      dbColumns: [],
      description: overrides.description ?? null,
      unknown: overrides.unknown ?? false,
    },
  };
}

export function tableNode(
  name: string,
  options: {
    columns?: readonly ColumnFact[];
    rlsEnabled?: boolean;
    framework?: boolean;
    scope?: { column: string; kind: "tenant" | "owner" } | null;
    unknown?: boolean;
  } = {},
): GraphNode {
  return {
    id: "table:" + name,
    kind: "table",
    label: name,
    sourceFile: "db/schema.ts",
    data: {
      kind: "table",
      table: name,
      columns: options.columns ?? [column("id", { primaryKey: true, notNull: true })],
      rlsEnabled: options.rlsEnabled ?? true,
      framework: options.framework ?? false,
      scope: options.scope ?? null,
      unknown: options.unknown ?? false,
    },
  };
}

export function workflowNode(
  name: string,
  steps: readonly {
    index: number;
    kind: "job" | "approval";
    name: string | null;
    permission?: string | null;
    onRejectStep?: number | null;
  }[] = [],
): GraphNode {
  return {
    id: "workflow:" + name,
    kind: "workflow",
    label: name,
    sourceFile: "server/workflows/" + name + ".ts",
    data: {
      kind: "workflow",
      name,
      steps: steps.map((step) => ({
        index: step.index,
        kind: step.kind,
        name: step.name,
        permission: step.permission ?? null,
        onRejectStep: step.onRejectStep ?? null,
      })),
      unknown: false,
    },
  };
}

export function graphOf(
  nodes: readonly GraphNode[],
  edges: ProjectGraph["edges"] = [],
): ProjectGraph {
  return { nodes, edges };
}

export const PAGE = pageNode("src/pages/todos.tsx", 2);
export const GET = routeNode("GET", "/api/todos");
export const TODOS = tableNode("todos", {
  columns: [
    column("id", { primaryKey: true, notNull: true }),
    column("title", { unique: true }),
    column("createdAt", { type: "timestamp", default: { kind: "now", value: null } }),
    column("staging", {
      unknown: [{ code: "schema-static", reason: "custom builder", source: ref("db/schema.ts") }],
    }),
  ],
});
export const PROJECTS = tableNode("projects");
export const WORKFLOW = workflowNode("purge", [
  { index: 0, kind: "job", name: "purge-todos" },
  {
    index: 1,
    kind: "approval",
    name: "workflows.purge.approval",
    permission: "tasks:decide",
    onRejectStep: 2,
  },
]);
