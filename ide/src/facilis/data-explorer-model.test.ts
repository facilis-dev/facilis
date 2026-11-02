import { describe, expect, it } from "vitest";
import type { DataExplorerData, ExplorerRoute } from "./data-explorer-client";
import { buildExplorerView } from "./data-explorer-model";

const ROUTE: ExplorerRoute = {
  method: "GET",
  path: "/api/todos",
  sourceFile: "server/routes/api/todos/index.get.ts",
  dbTables: ["todos"],
  dbColumns: ["todos.title"],
};

function baseData(): DataExplorerData {
  return {
    codeTables: [
      {
        name: "todos",
        scoped: true,
        columns: [{ name: "id", type: "uuid", notNull: true, default: null, primaryKey: true }],
        policies: [{ name: "tenant_isolation", command: "ALL", restrictive: true }],
      },
      { name: "planned", scoped: false, columns: [], policies: [] },
    ],
    liveTables: [
      {
        name: "todos",
        rlsEnabled: true,
        columns: [{ name: "id", type: "uuid", notNull: true, default: null, primaryKey: true }],
        policies: [{ name: "tenant_isolation", command: "ALL", restrictive: true }],
      },
      { name: "ghost", rlsEnabled: false, columns: [], policies: [] },
    ],
    drift: [
      { kind: "table_missing", table: "planned" },
      { kind: "table_extra", table: "ghost" },
    ],
    warnings: [],
    routes: [ROUTE],
  };
}

function table(view: ReturnType<typeof buildExplorerView>, name: string) {
  const found = view.tables.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(name + " table missing from the view");
  return found;
}

function withLiveTable(
  data: DataExplorerData,
  name: string,
  patch: Partial<DataExplorerData["liveTables"][number]>,
): DataExplorerData {
  return {
    ...data,
    liveTables: data.liveTables.map((entry) =>
      entry.name === name ? { ...entry, ...patch } : entry,
    ),
  };
}

describe("buildExplorerView", () => {
  it("merges code and live tables into a deterministic union", () => {
    const view = buildExplorerView(baseData());
    expect(view.tables.map((entry) => entry.name)).toEqual(["ghost", "planned", "todos"]);
    expect(view.synced).toBe(false);
    expect(view.drift).toHaveLength(2);
  });

  it("derives the RLS badge from the live state and the code scoping column", () => {
    const data = baseData();
    const view = buildExplorerView(data);
    expect(table(view, "todos").rls).toBe("policy");
    expect(table(view, "planned").rls).toBe("missing");
    expect(table(view, "ghost").rls).toBe("rls_off");

    const withoutPolicy = withLiveTable(data, "todos", { policies: [] });
    expect(table(buildExplorerView(withoutPolicy), "todos").rls).toBe("rls_without_policy");

    const scopedOff = withLiveTable(data, "todos", { rlsEnabled: false });
    expect(table(buildExplorerView(scopedOff), "todos").rls).toBe("rls_off_scoped");
  });

  it("prefers live columns and falls back to the code snapshot", () => {
    const view = buildExplorerView(baseData());
    expect(table(view, "todos").columns).toHaveLength(1);
    expect(table(view, "planned").columns).toEqual([]);
  });

  it("reverse-looks-up the routes that use a table through dbTables or dbColumns", () => {
    const data = baseData();
    data.routes.push({ ...ROUTE, method: "POST", path: "/api/todos" });
    const view = buildExplorerView(data);
    expect(table(view, "todos").usedBy).toHaveLength(2);
    expect(table(view, "todos").usedBy[0]).toMatchObject({
      method: "GET",
      sourceFile: "server/routes/api/todos/index.get.ts",
    });
    expect(table(view, "ghost").usedBy).toEqual([]);
  });
});
