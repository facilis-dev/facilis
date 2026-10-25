import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { parseSync, transformSync } from "rolldown/utils";
import type { ManifestWarning } from "@facilis/core";
import { asNode, type AstNode } from "./ast.ts";
import { extractRouteMetadata } from "./extract-metadata.ts";
import { routeFromRouteFile } from "./route-path.ts";
import type { RouteMetadata, RouteMetadataMap, ScanOptions } from "../types.ts";

const ROUTE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const NON_ROUTE_FILE_PATTERN = /\.(?:d\.ts|test\.[cm]?[jt]s|spec\.[cm]?[jt]s)$/;

/**
 * Statically scan `server/routes/**` and build the OpenAPI metadata map.
 *
 * Never imports or executes project route modules: files are parsed with rolldown's
 * transformer/parser only (SPEC §13 risk 3 mitigation). Unreadable or unparseable
 * files are reported through `onWarning` and skipped, so a broken route never takes
 * down the manifest/OpenAPI endpoints.
 */
export async function scanRouteMetadata(options: ScanOptions): Promise<RouteMetadataMap> {
  const files = await listRouteFiles(options.routesDir);
  const map: Record<string, Record<string, RouteMetadata>> = {};
  // Parse in parallel: transformation is CPU-bound in Rust and independent per file.
  const parsedFiles = await Promise.all(
    files.map(async (relativeFile) => ({
      relativeFile,
      parsed: await parseRouteFile(join(options.routesDir, relativeFile)),
    })),
  );

  for (const { relativeFile, parsed } of parsedFiles) {
    const location = routeFromRouteFile(relativeFile);
    if (!location) continue;
    const sourceFile = toSourceFile(relativeFile, options);
    if ("error" in parsed) {
      options.onWarning?.(routeScanWarning(sourceFile, parsed.error));
      continue;
    }
    const extracted = extractRouteMetadata(parsed.program, { sourceFile });
    if (!extracted) continue;

    const route: RouteMetadata = {
      method: location.method,
      path: location.path,
      permission: extracted.permission,
      dbTables: extracted.dbTables ?? [],
      dbColumns: extracted.dbColumns ?? [],
      description: extracted.description,
      unresolved: extracted.unresolved,
      sourceFile,
      warnings: extracted.warnings,
    };
    const operations = (map[location.path] ??= {});
    operations[location.method.toLowerCase()] = route;
  }

  return map;
}

async function listRouteFiles(routesDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(routesDir, { recursive: true });
  } catch {
    // No server/routes directory is a valid project state: nothing to scan.
    return [];
  }
  return entries
    .filter((entry) => ROUTE_FILE_PATTERN.test(entry) && !NON_ROUTE_FILE_PATTERN.test(entry))
    .map((entry) => entry.split(sep).join("/"))
    .toSorted((left, right) => left.localeCompare(right));
}

async function parseRouteFile(filePath: string): Promise<{ program: AstNode } | { error: string }> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    return { error: describeError(error) };
  }
  try {
    // transformSync strips TypeScript first: parseSync then always sees plain JS,
    // so `as const` and type annotations cannot hide a static literal.
    const transformed = transformSync(filePath, source, { tsconfig: false });
    if (transformed.errors.length > 0) {
      return { error: transformed.errors.map((error) => error.message).join("; ") };
    }
    const parsed = parseSync(filePath, transformed.code);
    if (parsed.errors.length > 0) {
      return { error: parsed.errors.map((error) => error.message).join("; ") };
    }
    const program = asNode(parsed.program);
    return program ? { program } : { error: "parser returned no program" };
  } catch (error) {
    return { error: describeError(error) };
  }
}

function toSourceFile(relativeFile: string, options: ScanOptions): string {
  if (!options.rootDir) return relativeFile;
  const absolute = join(options.routesDir, relativeFile);
  return relative(options.rootDir, absolute).split(sep).join("/");
}

function routeScanWarning(sourceFile: string, reason: string): ManifestWarning {
  return {
    code: "route-scan-error",
    message: `Could not statically scan ${sourceFile}: ${reason}`,
    section: "routes",
    sourceFile,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
