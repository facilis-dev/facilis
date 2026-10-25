import { defineHandler } from "nitro";

import { guardDevRequest } from "../runtime/http-guard.ts";
import { jsonResult, toResponse } from "../runtime/http.ts";
import { getRevisionSnapshot } from "../runtime/revision-service.ts";
import { bootedAt } from "../runtime/state.ts";

/**
 * GET /__facilis/health — boot detector used by Studio (SPEC §6.3/§6.7).
 *
 * Reaching this handler already means the Nitro worker is up; `status` stays "ok"
 * and the revision tells the client whether a full manifest fetch is needed.
 */
export default defineHandler(async (event) => {
  const guard = guardDevRequest(event.req.headers);
  if (guard) return toResponse(guard);

  const snapshot = await getRevisionSnapshot();
  return toResponse(
    jsonResult(
      200,
      { status: "ok", bootedAt, revision: snapshot.revision },
      { "cache-control": "no-cache" },
    ),
  );
});
