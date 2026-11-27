import { basename } from "node:path";
import { defineHandler } from "nitro";

import { serializeSecuritySurface } from "@facilis.dev/core";
import { guardDevRequest } from "../runtime/http-guard.ts";
import { buildSecuritySurfaceDocument } from "../security-surface.ts";
import { analyzeProjectRoutes } from "../route-metadata.ts";
import { jsonResult, toResponse } from "../runtime/http.ts";

const NO_CACHE = { "cache-control": "no-cache" } as const;

/**
 * GET /__facilis/security-surface.json (D-226, #235) — the IDE's on-demand download.
 *
 * It serves exactly the document the build writes (same builder, same serializer), so the
 * download cannot disagree with the release artifact. Dev-only: the production copy is the
 * file next to the server output.
 */
export default defineHandler(async (event): Promise<Response> => {
  const guard = guardDevRequest(event.req.headers);
  if (guard) return toResponse(guard);

  const root = process.cwd();
  const analysis = analyzeProjectRoutes(root);
  if (analysis === undefined) {
    return toResponse(jsonResult(404, { code: "not_found" }, { ...NO_CACHE }));
  }
  const document = buildSecuritySurfaceDocument(analysis, basename(root));
  return new Response(serializeSecuritySurface(document), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", ...NO_CACHE },
  });
});
