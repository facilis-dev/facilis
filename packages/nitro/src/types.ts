import type { ManifestWarning } from "@facilis/core";

/** HTTP methods a Facilis route file can declare (SPEC §7.3 RouteMeta.method). */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Config keys the route metadata pass can extract; anything else is ignored. */
export type MetadataField = "permission" | "dbTables" | "dbColumns" | "description" | "crossSite";

/**
 * One route's statically extracted metadata.
 *
 * `unresolved` records which fields were not statically readable, so the OpenAPI
 * facade can omit them instead of publishing a wrong value (SPEC §13 risk 3 / §6.9).
 */
export interface RouteMetadata {
  method: HttpMethod;
  /** OpenAPI-style path, e.g. `/api/todos/{id}`. */
  path: string;
  permission?: string | readonly string[];
  /** True when the route is declared callable from another origin; omitted otherwise. */
  crossSite?: boolean;
  /** `[]` when the config declares none or the value is not statically readable. */
  dbTables: readonly string[];
  dbColumns: readonly string[];
  description?: string;
  unresolved: readonly MetadataField[];
  /** Project-relative path for editor jump-to (RouteMeta.sourceFile). */
  sourceFile?: string;
  warnings: readonly ManifestWarning[];
}

/** Map keyed by OpenAPI path first, then lower-case method (OpenAPI's own casing). */
export type RouteMetadataMap = Readonly<Record<string, Readonly<Record<string, RouteMetadata>>>>;

export interface ScanOptions {
  /** Absolute project root; the analyzer owns the project's DSL layout (D-092). */
  rootDir: string;
  /** Receives warnings that belong to no route (parse/config diagnostics). */
  onWarning?: (warning: ManifestWarning) => void;
}

/**
 * Reserved plugin options.
 *
 * The analyzer derives the route layout (`server/routes/**`) from the project root (D-092),
 * so `facilis()` takes no options today; the type stays exported for the documented API.
 */
export type FacilisOptions = Record<string, never>;
