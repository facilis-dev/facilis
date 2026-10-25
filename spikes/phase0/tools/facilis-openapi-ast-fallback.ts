import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseSync, transformSync } from "rolldown/utils";
import type { Plugin } from "vite";

/**
 * Prototype of the SPEC §13-risk-3 fallback: a framework-owned AST pass.
 *
 * Why it exists: Nitro v3 only extracts x-db-tables route metadata from a
 * *top-level* `defineRouteMeta(...)` call in a route file (see
 * node_modules/nitro/dist/_build/common.mjs, plugin "nitro:route-meta"). When
 * defineRouteMeta is called inside defineAuthorizedHandler, the scanner never
 * sees it (proven: /_openapi.json has no x-db-tables for the wrapped route).
 *
 * This plugin does what Nitro cannot: it parses every file under server/routes,
 * statically reads the config object of a top-level `defineAuthorizedHandler(...)`
 * call, and exposes the result as a virtual module (`#facilis/openapi-meta`).
 * A companion facade route (server/openapi-facade.ts) fetches Nitro's generated
 * spec and merges this metadata in before serving /_openapi.json.
 *
 * Not production code: no cache invalidation on route-file edits, and it only
 * understands object-literal configs (same limitation as Nitro's own scanner).
 */

const VIRTUAL_ID = "\0facilis-openapi-meta";

const METHOD_RE = /\.(get|post|put|patch|delete|head|options)$/;

interface AstNode {
  type: string;
  [key: string]: unknown;
}

interface RouteMeta {
  [route: string]: Record<string, Record<string, unknown>>;
}

function literalValue(node: AstNode | undefined): unknown {
  if (!node) return undefined;
  switch (node.type) {
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const prop of (node.properties as AstNode[]) ?? []) {
        if (prop.type !== "Property") return undefined;
        const keyNode = (prop as { key: AstNode }).key;
        const key =
          (keyNode as { name?: string }).name ?? (keyNode as { value?: string }).value;
        if (key === undefined) return undefined;
        out[key] = literalValue((prop as { value: AstNode }).value);
      }
      return out;
    }
    case "ArrayExpression": {
      const out: unknown[] = [];
      for (const el of (node.elements as (AstNode | null)[]) ?? []) {
        if (!el) return undefined;
        out.push(literalValue(el));
      }
      return out;
    }
    case "Literal":
      return (node as { value: unknown }).value;
    default:
      return undefined;
  }
}

function asCalleeCall(node: AstNode | undefined, calleeName: string): { arguments: AstNode[] } | undefined {
  if (!node || node.type !== "CallExpression") return undefined;
  const call = node as { callee: AstNode; arguments: AstNode[] };
  if (call.callee.type !== "Identifier") return undefined;
  return (call.callee as { name?: string }).name === calleeName ? call : undefined;
}

function findTopLevelCall(
  program: AstNode,
  calleeName: string,
): { arguments: AstNode[] } | undefined {
  for (const statement of (program.body as AstNode[]) ?? []) {
    // defineRouteMeta is normally a bare statement…
    if (statement.type === "ExpressionStatement") {
      const call = asCalleeCall((statement as { expression: AstNode }).expression, calleeName);
      if (call) return call;
      continue;
    }
    // …while defineAuthorizedHandler is usually the default export expression.
    if (statement.type === "ExportDefaultDeclaration") {
      const call = asCalleeCall((statement as { declaration: AstNode }).declaration, calleeName);
      if (call) return call;
    }
  }
  return undefined;
}

function objectProperty(objectNode: AstNode, keyName: string): AstNode | undefined {
  for (const prop of (objectNode.properties as AstNode[]) ?? []) {
    if (prop.type !== "Property") continue;
    const keyNode = (prop as { key: AstNode }).key;
    const name =
      (keyNode as { name?: string; value?: string }).name ??
      (keyNode as { value?: string }).value;
    if (name === keyName) return (prop as { value: AstNode }).value;
  }
  return undefined;
}

function extractOpenApiMeta(program: AstNode): Record<string, unknown> | undefined {
  // Case 1: ordinary top-level defineRouteMeta(...) — Nitro already sees these.
  const direct = findTopLevelCall(program, "defineRouteMeta");
  if (direct) {
    const value = literalValue(direct.arguments[0]);
    const openAPI = (value as { openAPI?: unknown } | undefined)?.openAPI;
    return openAPI && typeof openAPI === "object"
      ? (openAPI as Record<string, unknown>)
      : undefined;
  }

  // Case 2: the A16 gap — defineRouteMeta lives inside defineAuthorizedHandler.
  const wrapped = findTopLevelCall(program, "defineAuthorizedHandler");
  if (!wrapped) return undefined;
  const config = wrapped.arguments[0];
  if (!config || config.type !== "ObjectExpression") return undefined;

  const openAPI: Record<string, unknown> = {};
  const description = literalValue(objectProperty(config, "description"));
  if (typeof description === "string") openAPI.description = description;
  const permission = literalValue(objectProperty(config, "permission"));
  if (permission !== undefined) openAPI["x-permission"] = permission;
  const dbTables = literalValue(objectProperty(config, "dbTables"));
  if (dbTables !== undefined) openAPI["x-db-tables"] = dbTables;
  const dbColumns = literalValue(objectProperty(config, "dbColumns"));
  if (dbColumns !== undefined) openAPI["x-db-columns"] = dbColumns;
  return openAPI;
}

function routeFromFile(routesDir: string, file: string): { route: string; method: string } | undefined {
  const rel = relative(routesDir, file).replace(/\\/g, "/");
  const withoutExt = rel.replace(/\.(ts|mts|js|mjs)$/, "");
  const methodMatch = withoutExt.match(METHOD_RE);
  const withoutMethod = methodMatch ? withoutExt.slice(0, -methodMatch[0].length) : withoutExt;
  const method = methodMatch ? methodMatch[1] : "get";
  const segments = withoutMethod.split("/");
  if (segments.at(-1) === "index") segments.pop();
  const route = "/" + segments.join("/");
  // Match Nitro's normalization of :param / [param] path parameters.
  const normalized = route
    .replace(/\[([^\]]+)\]/g, "{$1}")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  return { route: normalized, method };
}

async function collectRouteMeta(routesDir: string): Promise<RouteMeta> {
  const meta: RouteMeta = {};
  let entries: string[];
  try {
    entries = await readdir(routesDir, { recursive: true });
  } catch {
    return meta;
  }
  for (const entry of entries.sort()) {
    if (!/\.(ts|mts|js|mjs)$/.test(entry)) continue;
    const file = join(routesDir, entry);
    const routeInfo = routeFromFile(routesDir, file);
    if (!routeInfo) continue;
    let source: string;
    try {
      source = await readFileUtf8(file);
    } catch {
      continue;
    }
    try {
      const transformed = transformSync(file, source, { tsconfig: false });
      if (transformed.errors?.length) continue;
      const parsed = parseSync(file, transformed.code);
      if (parsed.errors?.length) continue;
      const openAPI = extractOpenApiMeta(parsed.program as unknown as AstNode);
      if (!openAPI || Object.keys(openAPI).length === 0) continue;
      meta[routeInfo.route] ??= {};
      meta[routeInfo.route][routeInfo.method] = openAPI;
    } catch {
      // Unparseable route file: skip, the facade leaves Nitro's spec untouched.
    }
  }
  return meta;
}

async function readFileUtf8(file: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(file, "utf8");
}

export function facilisOpenApiAstFallback(options: { routesDir: string }): Plugin {
  return {
    name: "facilis:openapi-ast-fallback",
    enforce: "pre",
    resolveId(id) {
      if (id === "#facilis/openapi-meta") return VIRTUAL_ID;
      return null;
    },
    async load(id) {
      if (id !== VIRTUAL_ID) return null;
      const meta = await collectRouteMeta(options.routesDir);
      return `export default ${JSON.stringify(meta)};`;
    },
  };
}