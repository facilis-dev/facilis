import { HTTPError, defineHandler, serverFetch } from "nitro";
import routeMeta from "#facilis/openapi-meta";

/**
 * Fallback /_openapi.json endpoint (SPEC §13 risk 3 / §6.9).
 *
 * Nitro serves its generated spec on an internal route (configured via
 * nitro.config.ts openAPI.route). This facade fetches it and merges the
 * framework-owned AST-pass metadata (x-permission / x-db-tables / x-db-columns
 * extracted from defineAuthorizedHandler route files) into each operation.
 */
export default defineHandler(async () => {
  // SPEC §6.8 / §8.5: /_openapi.json is a dev endpoint.
  if (process.env.NODE_ENV === "production") {
    throw new HTTPError({ status: 404 });
  }
  const response = await serverFetch("/_facilis/openapi.json");
  const spec = (await response.json()) as {
    paths?: Record<string, Record<string, Record<string, unknown>>>;
  };
  for (const [route, operations] of Object.entries(
    routeMeta as Record<string, Record<string, Record<string, unknown>>>,
  )) {
    const pathItem = spec.paths?.[route];
    if (!pathItem) continue;
    for (const [method, extra] of Object.entries(operations)) {
      const operation = pathItem[method];
      if (!operation) continue;
      Object.assign(operation, extra);
    }
  }
  return spec;
});
