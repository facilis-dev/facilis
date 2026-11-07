// The Entity Explorer's pure view model: merge the code snapshot, the live snapshot and
// the manifest routes into what DataExplorerPanel renders. Kept free of React and fetch so
// the badge/usage rules stay testable.

import type {
  CodeTable,
  DataExplorerData,
  ExplorerColumn,
  ExplorerPolicy,
  ExplorerRoute,
  ExplorerWarning,
  LiveTable,
  SchemaDriftEntry,
} from "./data-explorer-client";

export type RlsStatus = "policy" | "rls_without_policy" | "rls_off_scoped" | "rls_off" | "missing";

export interface ExplorerRouteUsage {
  method: string;
  path: string;
  sourceFile: string | null;
}

export interface ExplorerTable {
  name: string;
  inCode: boolean;
  inLive: boolean;
  /** A scoping column exists in `db/schema.ts` (tenant or owner, SPEC §8.4.5). */
  scoped: boolean;
  columns: ExplorerColumn[];
  policies: ExplorerPolicy[];
  rls: RlsStatus;
  drift: SchemaDriftEntry[];
  usedBy: ExplorerRouteUsage[];
}

export interface ExplorerView {
  tables: ExplorerTable[];
  drift: SchemaDriftEntry[];
  warnings: ExplorerWarning[];
  synced: boolean;
}

/** Build the panel view: one row per table, the union of code and live schemas. */
export function buildExplorerView(data: DataExplorerData): ExplorerView {
  const codeTables = new Map(data.codeTables.map((table) => [table.name, table]));
  const liveTables = new Map(data.liveTables.map((table) => [table.name, table]));
  const names = [...new Set([...codeTables.keys(), ...liveTables.keys()])].toSorted((left, right) =>
    left.localeCompare(right),
  );

  const tables = names.map((name) =>
    tableView(name, codeTables.get(name), liveTables.get(name), data),
  );
  return {
    tables,
    drift: data.drift,
    warnings: data.warnings,
    synced: data.drift.length === 0,
  };
}

function tableView(
  name: string,
  code: CodeTable | undefined,
  live: LiveTable | undefined,
  data: DataExplorerData,
): ExplorerTable {
  const scoped = code?.scoped === true;
  return {
    name,
    inCode: code !== undefined,
    inLive: live !== undefined,
    scoped,
    // The live columns are the database's truth; a code-only table still shows what the
    // schema declares, so a missing table is not an empty row.
    columns: live?.columns ?? code?.columns ?? [],
    policies: live?.policies ?? code?.policies ?? [],
    rls: rlsStatus(live, scoped),
    drift: data.drift.filter((entry) => entry.table === name),
    usedBy: routesForTable(name, data.routes),
  };
}

function rlsStatus(live: LiveTable | undefined, scoped: boolean): RlsStatus {
  if (live === undefined) return "missing";
  if (live.rlsEnabled) {
    return live.policies.length > 0 ? "policy" : "rls_without_policy";
  }
  return scoped ? "rls_off_scoped" : "rls_off";
}

function routesForTable(name: string, routes: readonly ExplorerRoute[]): ExplorerRouteUsage[] {
  const usage: ExplorerRouteUsage[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    if (!routeUsesTable(route, name)) continue;
    const key = route.method + " " + route.path;
    if (seen.has(key)) continue;
    seen.add(key);
    usage.push({ method: route.method, path: route.path, sourceFile: route.sourceFile });
  }
  return usage;
}

function routeUsesTable(route: ExplorerRoute, name: string): boolean {
  if (route.dbTables.includes(name)) return true;
  return route.dbColumns.some((column) => column === name || column.startsWith(name + "."));
}
