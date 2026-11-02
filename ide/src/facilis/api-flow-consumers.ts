// API Flow consumers (SPEC §10.2, §12 Phase 3): which client files reach which route.
//
// Pure by construction — the panel passes in the texts it already read from the VFS and
// gets back route-id → consumer references; no React, no fetch, no filesystem access.
// Route ids reproduce api-flow-model's `route:METHOD /path` so the panel can join the two
// structures without a second key scheme.
//
// `byRoute` lists only routes with at least one consumer (sorted by id); `unusedRoutes`
// carries the rest in `operations` order, so together they describe every route once.

import type { ApiMethod, ApiOperation } from "./api-flow-client";

/** A project file the panel already read; `path` is project-relative, without a leading `./`. */
export interface ApiFlowSourceFile {
  path: string;
  text: string;
}

/** Which part of the client tree a consumer lives in. */
export type ApiConsumerKind = "page" | "component" | "lib" | "other";

/** Alias for consumers that refer to the kind by the full module name. */
export type ApiFlowConsumerKind = ApiConsumerKind;

/** One client file that reaches a route, directly (`via: null`) or through an import. */
export interface ApiConsumerRef {
  path: string;
  kind: ApiConsumerKind;
  /** File that actually contains the URL when the consumer reaches it via an import, else null. */
  via: string | null;
}

export interface ApiFlowConsumers {
  /** key = route node id, exactly "route:" + METHOD + " " + path (same format as api-flow-model). */
  byRoute: Readonly<Record<string, readonly ApiConsumerRef[]>>;
  /** Route ids with no client consumer, in the order `operations` lists them. */
  unusedRoutes: readonly string[];
}

/** Kind precedence, so the consumer list is stable and pages stay first. */
const KIND_ORDER: Readonly<Record<ApiConsumerKind, number>> = {
  page: 0,
  component: 1,
  lib: 2,
  other: 3,
};

/** Files below these directories never count as API consumers (server code, data, deps, i18n). */
const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set(
  "server db node_modules .git locales".split(" "),
);

/** An `/api...` literal: single/double quoted or a template literal. */
const API_LITERAL = /(["'`])(\/api[^"'`\n\r]*)/g;

/** A literal is a route reference only when `/api` is followed by a segment boundary. */
const API_BOUNDARY = /^\/api(?:[/?#]|$)/;

/** Extensions tried after a bare specifier, then the same extensions on `/index`. */
const RESOLVE_EXTENSIONS: readonly string[] = ".ts .tsx .js .jsx .mts .mjs .cts .cjs".split(" ");

/** `import ... from "..."` / `export ... from "..."`, including multiline specifier lists. */
const FROM_IMPORT = /(?:^|[;\n])[ \t]*(?:import|export)\b[^"'`;]*?\bfrom[ \t]*["']([^"']+)["']/g;

/** Side-effect-only `import "..."`. */
const BARE_IMPORT = /(?:^|[;\n])[ \t]*import[ \t]*["']([^"']+)["']/g;

const CONSUMER_KEY_SEPARATOR = "\u0000";

interface RouteEntry {
  readonly id: string;
  readonly segments: readonly string[];
}

/**
 * Map every operation to the client files that reach it: a direct URL literal
 * (`via: null`) or a file importing a module that contains one (`via` = that module).
 * Same input always yields the same output, independent of file order.
 */
export function scanApiConsumers(
  files: readonly ApiFlowSourceFile[],
  operations: readonly ApiOperation[],
): ApiFlowConsumers {
  const routes = routeEntries(operations);
  const sources = readableSources(files);

  // route id → "consumer path\0via" → ref: the key makes direct/indirect hits dedupe.
  const consumersByRoute = new Map<string, Map<string, ApiConsumerRef>>();
  const directRoutesByFile = new Map<string, ReadonlySet<string>>();

  for (const [path, text] of sources) {
    const routeIds = new Set<string>();
    for (const reference of directReferences(text)) {
      const segments = pathSegments(reference);
      for (const route of routes) {
        if (matchesRoute(segments, route.segments)) routeIds.add(route.id);
      }
    }
    if (routeIds.size === 0) continue;
    directRoutesByFile.set(path, routeIds);
    const kind = kindOf(path);
    for (const routeId of routeIds)
      addConsumer(consumersByRoute, routeId, { path, kind, via: null });
  }

  const known = new Set(sources.keys());
  for (const [path, text] of sources) {
    const ownDirectRoutes = directRoutesByFile.get(path);
    const kind = kindOf(path);
    for (const specifier of importsOf(text)) {
      const target = resolveImport(path, specifier, known);
      if (target === null) continue;
      const targetRoutes = directRoutesByFile.get(target);
      if (targetRoutes === undefined) continue;
      for (const routeId of targetRoutes) {
        // A file that already references the route directly stays `via: null`.
        if (ownDirectRoutes?.has(routeId) === true) continue;
        addConsumer(consumersByRoute, routeId, { path, kind, via: target });
      }
    }
  }

  const byRoute: Record<string, readonly ApiConsumerRef[]> = {};
  for (const routeId of [...consumersByRoute.keys()].toSorted(compareStrings)) {
    const refs = consumersByRoute.get(routeId);
    byRoute[routeId] = refs === undefined ? [] : [...refs.values()].toSorted(compareConsumers);
  }

  const unusedRoutes = routes
    .filter((route) => !consumersByRoute.has(route.id))
    .map((route) => route.id);

  return { byRoute, unusedRoutes };
}

function routeEntries(operations: readonly ApiOperation[]): RouteEntry[] {
  const seen = new Set<string>();
  const entries: RouteEntry[] = [];
  for (const operation of operations) {
    const id = routeNodeId(operation.method, operation.path);
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, segments: pathSegments(operation.path) });
  }
  return entries;
}

const routeNodeId = (method: ApiMethod, path: string): string => "route:" + method + " " + path;

function readableSources(files: readonly ApiFlowSourceFile[]): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of files) {
    const path = normalizePath(file.path);
    if (path.length === 0 || isIgnored(path)) continue;
    sources.set(path, file.text);
  }
  return sources;
}

const isIgnored = (path: string): boolean =>
  path
    .split("/")
    .slice(0, -1)
    .some((segment) => IGNORED_DIRECTORIES.has(segment));

/** Project-relative path with `.`/`..`/`//` resolved and no leading `./`. */
function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function directReferences(text: string): string[] {
  const references = new Set<string>();
  for (const match of text.matchAll(API_LITERAL)) {
    const raw = match[2];
    if (raw === undefined || !API_BOUNDARY.test(raw)) continue;
    // Only the static part matches: drop the `${...}` tail and the query/hash.
    const template = raw.indexOf("${");
    const literal = template === -1 ? raw : raw.slice(0, template);
    const query = literal.search(/[?#]/);
    references.add(query === -1 ? literal : literal.slice(0, query));
  }
  return [...references];
}

function pathSegments(path: string): readonly string[] {
  const query = path.search(/[?#]/);
  const withoutQuery = query === -1 ? path : path.slice(0, query);
  return withoutQuery.split("/").filter((segment) => segment.length > 0);
}

/**
 * Route segments are OpenAPI-ish (`{id}`), Facilis-ish (`:id`, `[id]`) or a catch-all
 * (`*`); a reference shorter than the route is accepted only when every missing label
 * is dynamic — `/api/todos/` reaches `/api/todos/:id` but not `/api/todos/:id/comments`.
 */
function matchesRoute(reference: readonly string[], route: readonly string[]): boolean {
  if (reference.length > route.length) return false;
  for (let index = 0; index < reference.length; index += 1) {
    const routeSegment = route[index] ?? "";
    if (isDynamicSegment(routeSegment)) continue;
    if (routeSegment.toLowerCase() !== (reference[index] ?? "").toLowerCase()) return false;
  }
  for (let index = reference.length; index < route.length; index += 1) {
    if (!isDynamicSegment(route[index] ?? "")) return false;
  }
  return true;
}

function isDynamicSegment(segment: string): boolean {
  if (segment.startsWith(":") || segment.startsWith("*")) return true;
  if (segment.startsWith("[") && segment.endsWith("]")) return true;
  return segment.startsWith("{") && segment.endsWith("}");
}

function kindOf(path: string): ApiConsumerKind {
  if (path.startsWith("src/pages/") || path.startsWith("src/layouts/")) return "page";
  if (path.startsWith("src/components/")) return "component";
  if (path.startsWith("src/lib/") || path.startsWith("lib/")) return "lib";
  return "other";
}

function importsOf(text: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of [FROM_IMPORT, BARE_IMPORT]) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

/** Alias `@/src` and relative imports only; bare package specifiers are external. */
function resolveImport(
  importer: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = normalizePath("src/" + specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const slash = importer.lastIndexOf("/");
    base = normalizePath((slash === -1 ? "" : importer.slice(0, slash)) + "/" + specifier);
  } else {
    return null;
  }
  if (base.length === 0) return null;
  const candidates = [base];
  for (const extension of RESOLVE_EXTENSIONS) candidates.push(base + extension);
  for (const extension of RESOLVE_EXTENSIONS) candidates.push(base + "/index" + extension);
  for (const candidate of candidates) if (known.has(candidate)) return candidate;
  return null;
}

function addConsumer(
  byRoute: Map<string, Map<string, ApiConsumerRef>>,
  routeId: string,
  ref: ApiConsumerRef,
): void {
  const key = ref.path + CONSUMER_KEY_SEPARATOR + (ref.via ?? "");
  let refs = byRoute.get(routeId);
  if (refs === undefined) {
    refs = new Map<string, ApiConsumerRef>();
    byRoute.set(routeId, refs);
  }
  if (!refs.has(key)) refs.set(key, ref);
}

function compareConsumers(left: ApiConsumerRef, right: ApiConsumerRef): number {
  const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  if (byKind !== 0) return byKind;
  const byPath = compareStrings(left.path, right.path);
  if (byPath !== 0) return byPath;
  if (left.via === right.via) return 0;
  if (left.via === null) return -1;
  if (right.via === null) return 1;
  return compareStrings(left.via, right.via);
}

/** Code-unit order: stable across locales and machines, unlike localeCompare. */
function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
