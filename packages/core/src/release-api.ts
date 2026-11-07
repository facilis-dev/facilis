// API diff for a release preview (SPEC §7.7): routes are matched by method + path,
// and only fields both refs know are compared — a route parsed from a filename has
// no permission/dbTables, and "unknown" must never read as "removed".

import type { ApiDiff, ApiRouteChange, ApiRouteRef } from "./release.ts";
import type { ReleaseRouteFact } from "./release-preview.ts";

// ── API diff ───────────────────────────────────────────────────────────────────────

export function diffRoutes(
  before: readonly ReleaseRouteFact[],
  after: readonly ReleaseRouteFact[],
): ApiDiff {
  const beforeMap = routeMap(before);
  const afterMap = routeMap(after);
  const added: ApiRouteRef[] = [];
  const removed: ApiRouteRef[] = [];
  const changed: ApiRouteChange[] = [];
  for (const [key, route] of afterMap) {
    if (!beforeMap.has(key)) added.push(toRouteRef(route));
  }
  for (const [key, route] of beforeMap) {
    if (!afterMap.has(key)) removed.push(toRouteRef(route));
  }
  for (const [key, route] of afterMap) {
    const previous = beforeMap.get(key);
    if (previous === undefined) continue;
    const fields: string[] = [];
    if (
      accessKey(previous.permission) !== null &&
      accessKey(route.permission) !== null &&
      accessKey(previous.permission) !== accessKey(route.permission)
    )
      fields.push("permission");
    if (
      previous.dbTables !== undefined &&
      route.dbTables !== undefined &&
      !sameStrings(previous.dbTables, route.dbTables)
    )
      fields.push("dbTables");
    if (
      previous.sourceFile !== undefined &&
      route.sourceFile !== undefined &&
      previous.sourceFile !== route.sourceFile
    )
      fields.push("sourceFile");
    if (fields.length > 0)
      changed.push({ before: toRouteRef(previous), after: toRouteRef(route), fields });
  }
  return {
    added: added.toSorted(byRoute),
    removed: removed.toSorted(byRoute),
    changed: changed.toSorted((left, right) => byRoute(left.after, right.after)),
  };
}

function routeMap(routes: readonly ReleaseRouteFact[]): Map<string, ReleaseRouteFact> {
  return new Map(routes.map((route) => [route.method.toUpperCase() + " " + route.path, route]));
}

function toRouteRef(route: ReleaseRouteFact): ApiRouteRef {
  const ref: ApiRouteRef = { method: route.method.toUpperCase(), path: route.path };
  const permission = route.permission;
  return {
    ...ref,
    ...(permission === undefined ? {} : { permission }),
    ...(route.dbTables === undefined ? {} : { dbTables: [...route.dbTables] }),
    ...(route.sourceFile === undefined ? {} : { sourceFile: route.sourceFile }),
  };
}

function byRoute(left: ApiRouteRef, right: ApiRouteRef): number {
  return (left.method + " " + left.path).localeCompare(right.method + " " + right.path);
}

function accessKey(value: string | readonly string[] | undefined): string | null {
  if (value === undefined) return null;
  return typeof value === "string" ? value : [...value].toSorted().join("|");
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return accessKey(left) === accessKey(right);
}
