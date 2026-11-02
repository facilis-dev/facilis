/**
 * @facilis/nitro — the `facilis()` Vite plugin, its Nitro module, the framework AST
 * pass and the OpenAPI facade (SPEC §5.6, §6.9, §13 risk 3).
 *
 * Entry points: `@facilis/nitro` (everything), `@facilis/nitro/vite` (plugin),
 * `@facilis/nitro/module` (Nitro module), `@facilis/nitro/session` (route-facing server
 * cookie helpers; imports h3, so it is a separate entry point).
 */

export {
  DEV_SCHEMA_ROUTE,
  HEALTH_ROUTE,
  MANIFEST_REVISION_ROUTE,
  MANIFEST_ROUTE,
  NATIVE_OPENAPI_ROUTE,
  OPENAPI_FACADE_ROUTE,
} from "./constants.ts";
export { buildOpenApiFacadeResponse, mergeOpenApiMetadata } from "./facade.ts";
export type {
  OpenApiDocument,
  OpenApiFacadeDependencies,
  OpenApiOperation,
  OpenApiPathItem,
} from "./facade.ts";
export { createFacilisNitroModule, facilisNitroModule } from "./module.ts";
export { scanRouteMetadata } from "./ast/scanner.ts";
export type {
  FacilisOptions,
  HttpMethod,
  MetadataField,
  RouteMetadata,
  RouteMetadataMap,
  ScanOptions,
} from "./types.ts";
export { facilis } from "./vite.ts";
export type { FacilisPlugins, FacilisVitePlugin } from "./vite.ts";
export {
  RESOLVED_OPENAPI_META_ID,
  VIRTUAL_CONFIG_ID,
  VIRTUAL_DB_SCHEMA_ID,
  VIRTUAL_OPENAPI_META_ID,
} from "./virtual-ids.ts";
