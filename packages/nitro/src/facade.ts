import { NATIVE_OPENAPI_ROUTE } from "./constants.ts";
import { isProductionEnvironment } from "./runtime/env.ts";
import { jsonResult, type HttpResult } from "./runtime/http.ts";
import type { RouteMetadata, RouteMetadataMap } from "./types.ts";

export { NATIVE_OPENAPI_ROUTE };

export interface OpenApiOperation {
  [key: string]: unknown;
}

export interface OpenApiPathItem {
  [method: string]: OpenApiOperation;
}

export interface OpenApiDocument {
  openapi?: string;
  info?: Record<string, unknown>;
  paths?: Record<string, OpenApiPathItem>;
  [key: string]: unknown;
}

export interface OpenApiFacadeDependencies {
  metadata: RouteMetadataMap;
  fetchNativeSpec: () => Promise<OpenApiDocument | null>;
  isProduction?: () => boolean;
}

const EMPTY_SPEC: OpenApiDocument = {
  openapi: "3.1.0",
  info: { title: "Facilis API", version: "1.0.0" },
  paths: {},
};

/**
 * Copy `spec` and merge the AST-pass metadata into each operation (SPEC §6.9).
 *
 * Nitro cannot see the defineAuthorizedHandler config (Phase 0 A16), so the facade
 * is what puts x-db-tables / x-permission / description on `/_openapi.json`.
 * Fields the scanner could not read are omitted rather than guessed; they are
 * published as `x-facilis-warning` instead.
 */
export function mergeOpenApiMetadata(
  spec: OpenApiDocument,
  metadata: RouteMetadataMap,
): OpenApiDocument {
  const paths: Record<string, OpenApiPathItem> = { ...spec.paths };

  for (const [path, operations] of Object.entries(metadata)) {
    const pathItem = paths[path];
    if (!pathItem) continue;
    let mergedPath: OpenApiPathItem | undefined;
    for (const [method, route] of Object.entries(operations)) {
      const operation = pathItem[method];
      if (!operation) continue;
      mergedPath ??= { ...pathItem };
      mergedPath[method] = mergeOperation(operation, route);
    }
    if (mergedPath) paths[path] = mergedPath;
  }

  return { ...spec, paths };
}

function mergeOperation(operation: OpenApiOperation, route: RouteMetadata): OpenApiOperation {
  const merged: OpenApiOperation = { ...operation };
  if (route.description !== undefined) merged["description"] = route.description;
  if (route.permission !== undefined && !route.unresolved.includes("permission")) {
    merged["x-permission"] = route.permission;
  }
  if (!route.unresolved.includes("dbTables")) merged["x-db-tables"] = [...route.dbTables];
  if (!route.unresolved.includes("dbColumns")) merged["x-db-columns"] = [...route.dbColumns];
  if (route.crossSite === true) merged["x-cross-site"] = true;
  if (route.sourceFile !== undefined) merged["x-facilis-source"] = route.sourceFile;
  if (route.warnings.length > 0) {
    merged["x-facilis-warning"] = route.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    }));
  }
  if (merged["summary"] === undefined && route.description !== undefined) {
    merged["summary"] = route.description;
  }
  // Nitro tags scanned handlers "API Routes"; a facilis tag keeps augmented
  // operations identifiable in the visualizer without overriding user tags.
  merged["tags"] ??= ["facilis"];
  return merged;
}

/** Build the `/_openapi.json` response: dev-only facade over Nitro's native spec. */
export async function buildOpenApiFacadeResponse(
  dependencies: OpenApiFacadeDependencies,
): Promise<HttpResult> {
  const production = (dependencies.isProduction ?? isProductionEnvironment)();
  if (production) {
    return jsonResult(404, { code: "not_found" }, { "cache-control": "no-cache" });
  }

  let native: OpenApiDocument | null = null;
  try {
    native = await dependencies.fetchNativeSpec();
  } catch {
    native = null;
  }

  const warnings: Array<{ code: string; message: string }> = [];
  if (!native) {
    warnings.push({
      code: "openapi-unavailable",
      message:
        "Nitro's OpenAPI document is unavailable. Enable experimental.openAPI in nitro.config.ts " +
        `(native route: ${NATIVE_OPENAPI_ROUTE}).`,
    });
  }

  const merged = mergeOpenApiMetadata(native ?? EMPTY_SPEC, dependencies.metadata);
  if (warnings.length > 0) merged["x-facilis-warning"] = warnings;
  return jsonResult(200, merged, { "cache-control": "no-cache" });
}
