import { defineHandler } from "nitro";

import { getBootstrap } from "../runtime/bootstrap.ts";
import { DevQueryError, parseQueryBody, runQuery } from "../runtime/dev-query.ts";
import { guardDevRequest } from "../runtime/http-guard.ts";
import { jsonResult, toResponse } from "../runtime/http.ts";

const NO_CACHE = { "cache-control": "no-cache" } as const;

/**
 * POST /__facilis/dev/query — the Data Explorer's read-only SQL console (SPEC §11.2, D-097).
 *
 * 200 `{ columns, rows, rowCount, elapsedMs, truncated }`, 400 for a bad body / statement /
 * failed query, 403 on an origin mismatch, 404 in production, 503 when the runtime has no
 * database. A console query runs as the connecting superuser: the response is a developer
 * preview, not a permissions view (created views are security_invoker).
 */
export default defineHandler(async (event) => {
  const guard = guardDevRequest(event.req.headers);
  if (guard) return toResponse(guard);

  const state = await getBootstrap();
  if (state.db === null) return response(503, { code: "db_unavailable" });

  const body = await readJsonBody(event);
  if (!body.ok) return response(400, { code: "invalid_body" });
  const parsed = parseQueryBody(body.value);
  if (!parsed.ok) return response(400, { code: parsed.error.code, message: parsed.error.message });

  try {
    return response(200, await runQuery(state.db, parsed.request));
  } catch (error) {
    if (error instanceof DevQueryError) {
      return response(400, { code: error.code, message: error.message });
    }
    console.error("facilis: dev query failed", error);
    return response(400, { code: "query_failed" });
  }
});

type JsonBody = { ok: true; value: unknown } | { ok: false };

async function readJsonBody(event: { req: { json(): Promise<unknown> } }): Promise<JsonBody> {
  try {
    return { ok: true, value: await event.req.json() };
  } catch {
    return { ok: false };
  }
}

function response(status: number, body: unknown): Response {
  return toResponse(jsonResult(status, body, { ...NO_CACHE }));
}
