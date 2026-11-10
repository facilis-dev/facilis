import { buildManifest } from "@facilis/core";
import type {
  BlockManifest,
  FacilisConfig,
  FacilisManifest,
  LocaleCatalogs,
  ManifestWarning,
  RouteMeta,
  SchemaSnapshot,
} from "@facilis/core";

import type { RouteMetadata, RouteMetadataMap } from "../types.ts";

export interface ManifestDataSources {
  readonly config: FacilisConfig;
  readonly routeMetadata: RouteMetadataMap;
  /** Omitted when the schema could not be introspected; `schemaFailure` explains why. */
  readonly schema?: SchemaSnapshot;
  readonly schemaFailure?: ManifestWarning;
  readonly catalogs?: LocaleCatalogs;
  readonly blocks?: readonly BlockManifest[];
  readonly coreVersion?: string;
  readonly nitroVersion?: string;
}

export interface ManifestDataResult {
  readonly manifest: FacilisManifest;
  readonly warnings: readonly ManifestWarning[];
  /** True when a section failed and the response is a 200 partial (SPEC §6.4). */
  readonly partial: boolean;
}

/**
 * Pure assembler joining the toolchain outputs (AST pass, schema snapshot, locale
 * files) into the FacilisManifest contract. Kept free of fs/db access so the route
 * handlers stay thin and this logic is unit-testable.
 */
export function buildManifestData(sources: ManifestDataSources): ManifestDataResult {
  const routes = flattenRouteMetadata(sources.routeMetadata);
  const manifest = buildManifest({
    config: sources.config,
    routes: routes.map(toRouteMeta),
    schema: sources.schema,
    catalogs: sources.catalogs,
    blocks: sources.blocks === undefined ? undefined : sortBlocks(sources.blocks),
    coreVersion: sources.coreVersion,
    nitroVersion: sources.nitroVersion,
  });

  const warnings: ManifestWarning[] = routes.flatMap((route) => route.warnings);
  if (sources.schemaFailure !== undefined) warnings.push(sources.schemaFailure);

  return { manifest, warnings, partial: sources.schemaFailure !== undefined };
}

/** Deterministic order: path first, then HTTP method (visualizers and diffs depend on it). */
export function flattenRouteMetadata(metadata: RouteMetadataMap): readonly RouteMetadata[] {
  const routes: RouteMetadata[] = [];
  for (const path of Object.keys(metadata).toSorted((left, right) => left.localeCompare(right))) {
    const operations = metadata[path];
    if (operations === undefined) continue;
    for (const method of Object.keys(operations).toSorted((left, right) =>
      left.localeCompare(right),
    )) {
      const route = operations[method];
      if (route !== undefined) routes.push(route);
    }
  }
  return routes;
}

export function toRouteMeta(route: RouteMetadata): RouteMeta {
  return {
    method: route.method,
    path: route.path,
    summary: route.description,
    description: route.description,
    permission: route.permission,
    ...(route.crossSite === true ? { crossSite: true } : {}),
    dbTables: route.dbTables,
    dbColumns: route.dbColumns,
    security: deriveSecurity(route),
    sourceFile: route.sourceFile,
  };
}

/**
 * SPEC §7.3 security classification. A value the AST pass could not read is
 * "unknown", never "public": guessing would weaken the Studio's security view.
 */
function deriveSecurity(route: RouteMetadata): RouteMeta["security"] {
  if (route.unresolved.includes("permission")) return "unknown";
  const permission = route.permission;
  if (permission === undefined) return "public";
  if (typeof permission === "string") return permission.length === 0 ? "public" : "required";
  return permission.length === 0 ? "public" : "required";
}

function sortBlocks(blocks: readonly BlockManifest[]): readonly BlockManifest[] {
  return [...blocks].toSorted((left, right) => left.name.localeCompare(right.name));
}
