import { defineHandler } from "nitro";
import { diffSchemaSnapshots, liveSchemaSnapshot, schemaSnapshot } from "@facilis.dev/db";

import { getBootstrap } from "../runtime/bootstrap.ts";
import { guardDevRequest } from "../runtime/http-guard.ts";
import { jsonResult, toResponse } from "../runtime/http.ts";

const NO_CACHE = { "cache-control": "no-cache" } as const;

/**
 * GET /__facilis/dev/schema — code↔live schema introspection (SPEC §6.3/§11.1/§11.4).
 *
 * 200 `{ code, live, drift, warnings }`, 403 on an origin mismatch, 404 in production,
 * 503 `{ code: "db_unavailable" }` when the runtime has no usable database (still booting,
 * a failed migration, or a catalog query that cannot answer).
 */
export default defineHandler(async (event) => {
  const guard = guardDevRequest(event.req.headers);
  if (guard) return toResponse(guard);

  const state = await getBootstrap();
  if (state.db === null) return unavailable();

  try {
    const code = await schemaSnapshot(state.db);
    const live = await liveSchemaSnapshot(state.db);
    return toResponse(
      jsonResult(
        200,
        { code, live, drift: diffSchemaSnapshots(code, live), warnings: state.warnings },
        { ...NO_CACHE },
      ),
    );
  } catch {
    // Boot can succeed while a catalog query fails (a closed or broken cluster): answer
    // "no database" instead of leaking the driver error as an opaque 500.
    return unavailable();
  }
});

function unavailable(): Response {
  return toResponse(jsonResult(503, { code: "db_unavailable" }, { ...NO_CACHE }));
}
