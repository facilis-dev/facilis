import { defineHandler } from "nitro";

import { getBootstrap } from "../runtime/bootstrap.ts";
import { createView, DevQueryError, parseViewBody } from "../runtime/dev-query.ts";
import { guardDevRequest } from "../runtime/http-guard.ts";
import { jsonResult, toResponse } from "../runtime/http.ts";

const NO_CACHE = { "cache-control": "no-cache" } as const;

/**
 * POST /__facilis/dev/view — create (or replace) a view from the query console (D-097/D-098).
 *
 * The Studio writes db/views/<name>.ts afterwards; this endpoint makes the view usable
 * immediately. Without a permission the view is `security_invoker = true` (base tables' RLS);
 * with one it is a definer view gated by that permission, which must already be declared in
 * facilis.config.ts — the console cannot invent a new permission. Dev-only,
 * origin-allowlisted, 404 in production.
 */
export default defineHandler(async (event) => {
  const guard = guardDevRequest(event.req.headers);
  if (guard) return toResponse(guard);

  const state = await getBootstrap();
  if (state.db === null) return response(503, { code: "db_unavailable" });

  const body = await readJsonBody(event);
  if (!body.ok) return response(400, { code: "invalid_body" });
  const parsed = parseViewBody(body.value);
  if (!parsed.ok) return response(400, { code: parsed.error.code, message: parsed.error.message });

  const permission = parsed.request.permission;
  if (permission !== null) {
    const declared = state.config?.auth.permissions ?? [];
    if (!declared.includes(permission)) {
      return response(400, {
        code: "invalid_permission",
        message: `Permission "${permission}" is not declared in facilis.config.ts.`,
      });
    }
  }

  try {
    await createView(state.db, parsed.request);
    return response(200, { name: parsed.request.name });
  } catch (error) {
    if (error instanceof DevQueryError) {
      return response(400, { code: error.code, message: error.message });
    }
    console.error("facilis: dev view creation failed", error);
    return response(400, { code: "create_failed" });
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
