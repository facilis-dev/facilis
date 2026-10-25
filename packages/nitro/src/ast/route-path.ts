import type { HttpMethod } from "../types.ts";

export interface RouteLocation {
  method: HttpMethod;
  /** OpenAPI-style path with `{param}` markers, e.g. `/api/todos/{id}`. */
  path: string;
}

const METHOD_SUFFIX = /\.(get|post|put|patch|delete)$/;
const ENV_SUFFIX = /\.(dev|prod|prerender)$/;
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Derive the route location from a route file name the same way Nitro's file
 * router does (SPEC §4.2): `index.get.ts` -> GET /, `[id].patch.ts` -> PATCH {id},
 * `(group)` directories are dropped, `.dev/`.prod` env suffixes are stripped.
 *
 * OpenAPI path templates are used because the facade merges against Nitro's
 * generated spec, whose normalizer rewrites `:param` to `{param}`.
 */
export function routeFromRouteFile(relativeFile: string): RouteLocation | undefined {
  const normalized = relativeFile.replace(/\\/g, "/");
  const withoutExtension = normalized.replace(SOURCE_EXTENSION, "");
  const segments = withoutExtension.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;

  const lastIndex = segments.length - 1;
  const parsed = parseLastSegment(segments[lastIndex] ?? "");
  if (!parsed) return undefined;
  segments[lastIndex] = parsed.name;
  if (parsed.name === "index") segments.pop();

  const pathSegments = segments
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .map(toOpenApiSegment);
  return {
    method: parsed.method,
    path: pathSegments.length === 0 ? "/" : `/${pathSegments.join("/")}`,
  };
}

function parseLastSegment(segment: string): { name: string; method: HttpMethod } | undefined {
  let name = segment;
  const envMatch = name.match(ENV_SUFFIX);
  if (envMatch) name = name.slice(0, -envMatch[0].length);

  const methodMatch = name.match(METHOD_SUFFIX);
  const method = (methodMatch?.[1]?.toUpperCase() ?? "GET") as HttpMethod;
  if (methodMatch) name = name.slice(0, -methodMatch[0].length);

  if (name.length === 0) return undefined;
  return { name, method };
}

function toOpenApiSegment(segment: string): string {
  // Optional params `[[id]]` and catch-all `[...slug]` keep their special form;
  // named params become OpenAPI templates.
  const optional = segment.match(/^\[\[(.+)\]\]$/);
  if (optional?.[1]) return `{${optional[1]}}`;
  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll?.[1]) return `{*${catchAll[1]}}`;
  const named = segment.match(/^\[(.+)\]$/);
  if (named?.[1]) return `{${named[1]}}`;
  return segment.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}
