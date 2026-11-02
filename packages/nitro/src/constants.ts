/** Paths served by @facilis/nitro; shared by the Nitro module and the runtime routes. */
export const OPENAPI_FACADE_ROUTE = "/_openapi.json";
/** Where Nitro's own generated spec is kept intact (dev-only internal route). */
export const NATIVE_OPENAPI_ROUTE = "/_facilis/openapi.json";
export const MANIFEST_ROUTE = "/__facilis/manifest";
export const MANIFEST_REVISION_ROUTE = "/__facilis/manifest/revision";
export const HEALTH_ROUTE = "/__facilis/health";
/** Live schema introspection for the Entity Explorer (SPEC §6.3/§11.4). */
export const DEV_SCHEMA_ROUTE = "/__facilis/dev/schema";
