import { defineHandler, serverFetch } from "nitro";
import routeMetadata from "#facilis/openapi-meta";

import {
  buildOpenApiFacadeResponse,
  NATIVE_OPENAPI_ROUTE,
  type OpenApiDocument,
} from "../facade.ts";
import { toResponse } from "../runtime/http.ts";

async function fetchNativeSpec(): Promise<OpenApiDocument | null> {
  try {
    const response = await serverFetch(NATIVE_OPENAPI_ROUTE);
    if (!response.ok) return null;
    return (await response.json()) as OpenApiDocument;
  } catch {
    // OpenAPI disabled or the internal route is not built yet: the facade reports it.
    return null;
  }
}

/**
 * GET /_openapi.json — the public, AST-augmented OpenAPI document (SPEC §6.9).
 *
 * Nitro's own generator stays intact on /_facilis/openapi.json; this handler fetches
 * it in-process and merges the metadata Nitro's scanner cannot see.
 */
export default defineHandler(async () => {
  const result = await buildOpenApiFacadeResponse({
    metadata: routeMetadata,
    fetchNativeSpec,
  });
  return toResponse(result);
});
