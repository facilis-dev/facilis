// Route facts derived from a project's file tree (SPEC §11.3, D-086).
//
// At a git ref the Studio cannot read a handler's `defineAuthorizedHandler` config, so the
// route's method and path come from Nitro's file-router names and nothing else. `permission`
// / `dbTables` / `dbColumns` stay undefined there ("unknown at this ref", never "none"); the
// working-copy lens fills them from the manifest with mergeRouteMetadata().

import type { ReleaseRouteFact } from "./release-engine";

const ROUTE_FILE = /^server\/routes\/(.+)\.(?:ts|js)$/;
const LEAF = /^(.*)\.([^.]+)$/;
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const PARAM = /^\[([^\]]+)\]$/;
const CATCH_ALL = /^\[\.\.\.([^\]]+)\]$/;

/** One fact per routable file, sorted by method + path so a diff is deterministic. */
export function routesFromFiles(files: readonly string[]): ReleaseRouteFact[] {
  const routes: ReleaseRouteFact[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const route = routeFromFile(file);
    if (route === null) continue;
    const key = routeKey(route);
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(route);
  }
  return routes.toSorted(compareRoutes);
}

function routeFromFile(file: string): ReleaseRouteFact | null {
  const relative = ROUTE_FILE.exec(file)?.[1];
  if (relative === undefined) return null;
  const segments = relative.split("/");
  const leaf = segments.pop();
  if (leaf === undefined) return null;
  const leafMatch = LEAF.exec(leaf);
  if (leafMatch === null) return null;
  const method = (leafMatch[2] ?? "").toLowerCase();
  if (!METHODS.has(method)) return null;
  return {
    method: method.toUpperCase(),
    path: routePath([...segments, leafMatch[1] ?? ""]),
    sourceFile: file,
  };
}

function routePath(segments: readonly string[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0 || segment === "index") continue;
    const catchAll = CATCH_ALL.exec(segment);
    if (catchAll !== null) {
      parts.push(":" + catchAll[1] + "*");
      continue;
    }
    const param = PARAM.exec(segment);
    parts.push(param === null ? segment : ":" + param[1]);
  }
  return "/" + parts.join("/");
}

/**
 * Read routes out of the manifest (SPEC §6.9). Unknown entries are skipped rather than
 * guessed at; `sourceFile` is kept so a click can jump to the handler.
 */
export function parseManifestRoutes(value: unknown): ReleaseRouteFact[] {
  if (!Array.isArray(value)) return [];
  const routes: ReleaseRouteFact[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const method = readString(entry["method"]);
    const path = readString(entry["path"]);
    if (method === null || path === null) continue;
    const sourceFile = readString(entry["sourceFile"]);
    const permission = readPermission(entry["permission"]);
    const dbTables = readStringArray(entry["dbTables"]);
    const dbColumns = readStringArray(entry["dbColumns"]);
    routes.push({
      method: method.toUpperCase(),
      path,
      ...(sourceFile === null ? {} : { sourceFile }),
      ...(permission === null ? {} : { permission }),
      ...(dbTables === null ? {} : { dbTables }),
      ...(dbColumns === null ? {} : { dbColumns }),
    });
  }
  return routes;
}

/**
 * Union of the file-derived routes and the manifest's metadata, keyed by method + path.
 * A route the manifest knows but no file matched is kept: the manifest is the runtime
 * truth, and dropping it would hide an API change.
 */
export function mergeRouteMetadata(
  derived: readonly ReleaseRouteFact[],
  metadata: readonly ReleaseRouteFact[],
): ReleaseRouteFact[] {
  const byKey = new Map(metadata.map((route) => [routeKey(route), route]));
  const seen = new Set<string>();
  const merged: ReleaseRouteFact[] = [];
  for (const route of derived) {
    const key = routeKey(route);
    seen.add(key);
    const meta = byKey.get(key);
    merged.push(
      meta === undefined
        ? route
        : {
            ...route,
            ...(meta.sourceFile === undefined ? {} : { sourceFile: meta.sourceFile }),
            ...(meta.permission === undefined ? {} : { permission: meta.permission }),
            ...(meta.dbTables === undefined ? {} : { dbTables: meta.dbTables }),
            ...(meta.dbColumns === undefined ? {} : { dbColumns: meta.dbColumns }),
          },
    );
  }
  for (const route of metadata) {
    const key = routeKey(route);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(route);
  }
  return merged.toSorted(compareRoutes);
}

function routeKey(route: ReleaseRouteFact): string {
  return route.method.toUpperCase() + " " + route.path;
}

function compareRoutes(left: ReleaseRouteFact, right: ReleaseRouteFact): number {
  return routeKey(left).localeCompare(routeKey(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    strings.push(entry);
  }
  return strings;
}

function readPermission(value: unknown): string | string[] | null {
  if (typeof value === "string") return value;
  return readStringArray(value);
}
