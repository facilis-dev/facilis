/**
 * Route file name -> method/path (Nitro's file router, SPEC §4.2).
 *
 * Kept apart from the route pass so the filename rules are testable and the pass stays within
 * the file-length limit. Two deliberate extensions over @facilis/nitro's route-path: every
 * HTTP method is recognized, and a method-less file serves ALL methods (Nitro's behavior).
 */

import type { HttpMethod, RouteFact } from "../types.ts";

export interface RouteLocation {
  readonly method: HttpMethod;
  readonly path: string;
}

const METHOD_SUFFIX = /\.(get|post|put|patch|delete|head|options|trace|connect)$/;
const ENV_SUFFIX = /\.(dev|prod|prerender)$/;
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;

function toOpenApiSegment(segment: string): string {
  // Optional params `[[id]]` and catch-all `[...slug]` keep their special form; named
  // params become OpenAPI templates, matching the spec Nitro generates.
  const optional = /^\[\[(.+)\]\]$/.exec(segment);
  if (optional?.[1] !== undefined) return "{" + optional[1] + "}";
  const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment);
  if (catchAll?.[1] !== undefined) return "{*" + catchAll[1] + "}";
  const named = /^\[(.+)\]$/.exec(segment);
  if (named?.[1] !== undefined) return "{" + named[1] + "}";
  return segment.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function parseRouteSegment(segment: string): { name: string; method: HttpMethod } | undefined {
  let name = segment;
  const env = name.match(ENV_SUFFIX);
  if (env !== null) name = name.slice(0, -env[0].length);
  let method: HttpMethod = "ALL";
  const methodMatch = name.match(METHOD_SUFFIX);
  if (methodMatch?.[1] !== undefined) {
    method = methodMatch[1].toUpperCase() as HttpMethod;
    name = name.slice(0, -methodMatch[0].length);
  }
  return name.length === 0 ? undefined : { name, method };
}

/** Derive the route location from its file name relative to the routes directory. */
export function routeLocationFromFile(relativeRouteFile: string): RouteLocation | undefined {
  const normalized = relativeRouteFile.replace(/\\/g, "/").replace(SOURCE_EXTENSION, "");
  const segments = normalized.split("/").filter(Boolean);
  const last = segments.length - 1;
  if (last < 0) return undefined;
  const parsed = parseRouteSegment(segments[last] ?? "");
  if (parsed === undefined) return undefined;
  if (parsed.name === "index") segments.pop();
  else segments[last] = parsed.name;
  const path = segments.filter((segment) => !/^\(.+\)$/.test(segment)).map(toOpenApiSegment);
  return { method: parsed.method, path: path.length === 0 ? "/" : "/" + path.join("/") };
}

/** Stable route id shared by facts and the project graph. */
export function routeFactId(route: Pick<RouteFact, "method" | "path">): string {
  return "route:" + route.method + " " + route.path;
}
