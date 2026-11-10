/**
 * Route facts -> manifest/OpenAPI metadata adapter (D-092).
 *
 * @facilis/analyze owns the route DSL: it parses the project with oxc and reports one
 * RouteFact per route file, including files that do not use the wrapper. This module is the
 * only place @facilis/nitro touches the analyzer; it maps that fact model onto the
 * RouteMetadataMap contract the facade and manifest still consume.
 */
import { existsSync } from "node:fs";

import { analyzeProject } from "@facilis/analyze";
import type { Analysis, Diagnostic, RouteFact } from "@facilis/analyze";
import { loadProjectFiles } from "@facilis/analyze/fs";
import type { ManifestWarning } from "@facilis/core";

import { createRolldownParser } from "./rolldown-parser.ts";
import type {
  HttpMethod,
  MetadataField,
  RouteMetadata,
  RouteMetadataMap,
  ScanOptions,
} from "./types.ts";

/** The directories the analyzer treats as the route table (its DSL layout). */
const ROUTE_DIRS = ["server/routes/", "server/api/"];

/**
 * Core's RouteMeta.HttpMethod is the manifest contract. The analyzer also knows
 * HEAD/OPTIONS/TRACE/CONNECT/ALL; widening a cross-package contract is a separate change, so
 * those routes are omitted here (with a warning) instead of entering the map under a method
 * the manifest cannot type.
 */
const MANIFEST_METHODS: ReadonlySet<string> = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/** Framework sources are shipped code: their diagnostics are not the project's. */
const FRAMEWORK_PREFIX = "node_modules/";

/** Diagnostics outside the route pass that the plugin reports at startup/build. */
function isProjectLevelDiagnostic(code: string): boolean {
  return code === "parse-error" || code.startsWith("config-");
}

function isManifestMethod(method: string): method is HttpMethod {
  return MANIFEST_METHODS.has(method);
}

/** Narrow a route fact to the five methods the manifest contract models. */
function isManifestRoute(fact: RouteFact): fact is RouteFact & { readonly method: HttpMethod } {
  return isManifestMethod(fact.method);
}

function isFrameworkFile(file: string): boolean {
  return file.startsWith(FRAMEWORK_PREFIX);
}

function isRouteFile(file: string): boolean {
  return ROUTE_DIRS.some((directory) => file.startsWith(directory));
}

/**
 * Analyze the project once. Undefined when the root does not exist: there is nothing to
 * read, and the fs loader would throw on the missing directory.
 *
 * The analyzer's main entry is parser-injected: this adapter supplies rolldown's oxc parser so
 * the Vite plugin never loads the analyzer's native-node parser in the Studio's WebContainer
 * (D-092). The file walker is the parser-free `@facilis/analyze/fs` subpath.
 */
export function analyzeProjectRoutes(rootDir: string): Analysis | undefined {
  if (!existsSync(rootDir)) return undefined;
  return analyzeProject({ files: loadProjectFiles(rootDir), parser: createRolldownParser() });
}

/** Run the analyzer over `options.rootDir` and map its route facts to the metadata contract. */
export function scanRouteMetadata(options: ScanOptions): RouteMetadataMap {
  const analysis = analyzeProjectRoutes(options.rootDir);
  if (analysis === undefined) return {};
  return routeMetadataFromAnalysis(analysis, options.onWarning);
}

/**
 * Map an analysis onto the manifest/OpenAPI contract.
 *
 * Facts the analyzer could not determine are null; they become `unresolved` entries (so the
 * facade omits the field) while the map's arrays keep their historical `[]` fallback. A
 * null field is never turned into a guessed value: "unknown" must not look "public".
 */
export function routeMetadataFromAnalysis(
  analysis: Analysis,
  onWarning?: (warning: ManifestWarning) => void,
): RouteMetadataMap {
  const routesByFile = new Map<string, ManifestWarning[]>();
  const routeFiles = new Set(analysis.routes.map((fact) => fact.sourceFile));
  const supportedFacts = analysis.routes.filter(isManifestRoute);

  for (const fact of analysis.routes) {
    if (isManifestMethod(fact.method)) continue;
    // Route facts only ever come from project route files, but the guard keeps the
    // "framework sources are never reported" rule explicit.
    if (!isFrameworkFile(fact.sourceFile)) {
      report(onWarning, {
        code: "route-method-unsupported",
        message:
          `Route ${fact.sourceFile} declares ${fact.method}, outside the manifest's ` +
          `HttpMethod contract; it is omitted from the route metadata.`,
        section: "routes",
        sourceFile: fact.sourceFile,
      });
    }
  }

  const mappedFiles = new Set(supportedFacts.map((fact) => fact.sourceFile));
  for (const diagnostic of analysis.diagnostics) {
    const file = diagnostic.source?.file;
    if (file !== undefined && isFrameworkFile(file)) continue;
    const belongsToRouteFile = file !== undefined && (routeFiles.has(file) || isRouteFile(file));
    if (belongsToRouteFile) {
      const warning = toWarning(diagnostic, file);
      const mapped = mappedFiles.has(file);
      if (!mapped) {
        // No RouteMetadata to attach to (e.g. the method is not in the manifest contract),
        // so the warning is reported at file level instead of being dropped.
        report(onWarning, warning);
        continue;
      }
      const warnings = routesByFile.get(file) ?? [];
      warnings.push(warning);
      routesByFile.set(file, warnings);
      continue;
    }
    if (isProjectLevelDiagnostic(diagnostic.code)) {
      report(onWarning, toWarning(diagnostic, file));
    }
  }

  const map: Record<string, Record<string, RouteMetadata>> = {};
  for (const fact of supportedFacts) {
    const operations = (map[fact.path] ??= {});
    operations[fact.method.toLowerCase()] = toRouteMetadata(
      fact,
      routesByFile.get(fact.sourceFile) ?? [],
    );
  }
  return map;
}

function toRouteMetadata(
  fact: RouteFact & { readonly method: HttpMethod },
  warnings: readonly ManifestWarning[],
): RouteMetadata {
  const unresolved: MetadataField[] = [];
  if (fact.permission === null) unresolved.push("permission");
  if (fact.dbTables === null) unresolved.push("dbTables");
  if (fact.dbColumns === null) unresolved.push("dbColumns");
  if (fact.crossSite === null) unresolved.push("crossSite");

  return {
    method: fact.method,
    path: fact.path,
    ...(fact.permission === null ? {} : { permission: fact.permission }),
    ...(fact.crossSite === true ? { crossSite: true } : {}),
    dbTables: fact.dbTables ?? [],
    dbColumns: fact.dbColumns ?? [],
    ...(fact.description === null ? {} : { description: fact.description }),
    unresolved,
    sourceFile: fact.sourceFile,
    warnings,
  };
}

function toWarning(diagnostic: Diagnostic, sourceFile: string | undefined): ManifestWarning {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    section: "routes",
    ...(sourceFile === undefined ? {} : { sourceFile }),
  };
}

function report(
  onWarning: ((warning: ManifestWarning) => void) | undefined,
  warning: ManifestWarning,
): void {
  onWarning?.(warning);
}
