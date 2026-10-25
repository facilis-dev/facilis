import type { ManifestWarning } from "@facilis/core";

/** HTTP methods a Facilis route file can declare (SPEC §7.3 RouteMeta.method). */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Config keys the AST pass can extract statically; anything else is ignored. */
export type MetadataField = "permission" | "dbTables" | "dbColumns" | "description";

/**
 * One route's statically extracted metadata.
 *
 * `unresolved` records which fields were present but not statically readable, so
 * the OpenAPI facade can omit them instead of publishing a wrong value (SPEC §13
 * risk 3 / §6.9).
 */
export interface RouteMetadata {
  method: HttpMethod;
  /** OpenAPI-style path, e.g. `/api/todos/{id}`. */
  path: string;
  permission?: string | readonly string[];
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
  /** Absolute path to the project's `server/routes` directory. */
  routesDir: string;
  /** Absolute project root; when set, `sourceFile` becomes project-relative. */
  rootDir?: string;
  /** Receives file-level warnings (unparseable files) that belong to no route. */
  onWarning?: (warning: ManifestWarning) => void;
}

export interface FacilisOptions {
  /** `server/routes` by default; relative paths resolve against the Vite root. */
  routesDir?: string;
}
