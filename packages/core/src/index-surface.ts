export { defineRawRoute } from "./raw-route.ts";
export type { RawRouteAuth, RawRouteConfig, RawRouteHandler } from "./raw-route.ts";
export { defineServerExtension } from "./server-extension.ts";
export type { ServerExtensionConfig, ServerExtensionKind } from "./server-extension.ts";
export {
  assertSurfaceReason,
  brandRouteHandler,
  brandServerExtension,
  isFacilisRouteHandler,
  isFacilisServerExtension,
  SURFACE_CLASSES,
  surfaceDeclaration,
  SurfaceDeclarationError,
} from "./surface.ts";
export type {
  SurfaceClass,
  SurfaceDeclaration,
  SurfaceDeclarationFact,
  SurfaceKind,
} from "./surface.ts";
export type { RawDbAccessor, RawDbOptions, RawRouteContext } from "./route-context.ts";
export {
  attachRequestDatabase,
  detachRequestDatabase,
  requestDatabase,
} from "./request-database.ts";
export {
  parseSecuritySurface,
  SECURITY_SURFACE_FORMAT_VERSION,
  securitySurfaceSchema,
  serializeSecuritySurface,
  SERVER_EXTENSION_KIND_VALUES,
  SURFACE_CLASS_VALUES,
  SURFACE_KIND_VALUES,
} from "./security-surface.ts";
export type {
  SecuritySurfaceDocument,
  SecuritySurfaceDynamicCode,
  SecuritySurfaceExtension,
  SecuritySurfaceImport,
  SecuritySurfaceParseResult,
  SecuritySurfaceRoute,
  SecuritySurfaceSummary,
} from "./security-surface.ts";
