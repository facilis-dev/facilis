import { defineHandler } from "nitro";

import { guardDevRequest } from "../runtime/http-guard.ts";
import { jsonResult, parseRequestUrl, toResponse } from "../runtime/http.ts";
import { isNotModified, manifestHeaders, notModifiedResult } from "../runtime/manifest-response.ts";
import { getRevisionSnapshot } from "../runtime/revision-service.ts";

/**
 * GET /__facilis/manifest/revision — cheap freshness poll (SPEC §6.3).
 *
 * Deliberately skips the database: the revision only depends on project files and
 * the AST-pass metadata, so Studio can poll this every 2s (SPEC §6.6).
 */
export default defineHandler(async (event) => {
  const guard = guardDevRequest(event.req.headers);
  if (guard) return toResponse(guard);

  const url = parseRequestUrl(event.req.url);
  const snapshot = await getRevisionSnapshot();

  if (
    isNotModified({
      ifNoneMatch: event.req.headers.get("if-none-match"),
      since: url.searchParams.get("since"),
      revision: snapshot.revision,
    })
  ) {
    return toResponse(notModifiedResult(snapshot.revision));
  }

  return toResponse(
    jsonResult(
      200,
      { revision: snapshot.revision, generatedAt: snapshot.generatedAt },
      manifestHeaders(snapshot.revision, false),
    ),
  );
});
