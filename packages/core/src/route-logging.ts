import type { AuthContext } from "@facilis.dev/auth";

import type { FacilisRequestEvent } from "./event.ts";
import {
  NOOP_LOGGING_API,
  createAccessEntry,
  createErrorEntry,
  newLogRequestId,
  requestPath,
  type FacilisLogger,
  type FacilisLogRequestMeta,
} from "./logging.ts";

/**
 * Request-scoped logging for `defineAuthorizedHandler` (D-119).
 *
 * The wrapper builds this once per request and (a) exposes the bound `ctx.log`, (b) records
 * the access entry in a finally block so every exit path is counted, (c) records unexpected
 * errors server-side. When no logging runtime is attached (unit tests, a standalone Fetch
 * runtime) everything degrades to no-ops.
 */
export interface RequestLogging {
  readonly requestId: string;
  readonly log: FacilisLogger;
  /** Records the access entry exactly once with the final HTTP status. */
  finish(status: number): void;
  /** Records the server-side error entry; the client still receives the canonical code. */
  recordError(error: unknown, code: string): void;
}

export function startRequestLogging(
  event: FacilisRequestEvent,
  auth: AuthContext | null,
  tenantId: string,
): RequestLogging {
  const facilis = event.context.facilis;
  const logging = facilis?.logging ?? NOOP_LOGGING_API;
  const requestId = facilis?.requestId ?? newLogRequestId();
  const method = event.req.method ?? "GET";
  const path = requestPath(event.req.url);
  const client = facilis?.client;
  const meta: FacilisLogRequestMeta = {
    requestId,
    method,
    path,
    ...(auth === null
      ? {}
      : {
          userId: auth.userId,
          ...(auth.sessionHash === undefined ? {} : { sessionHash: auth.sessionHash }),
        }),
    ...(client?.ip === undefined ? {} : { ip: client.ip }),
    ...(client?.userAgent === undefined ? {} : { userAgent: client.userAgent }),
    ...(tenantId.length === 0 ? {} : { tenantId }),
  };
  const startedAt = performance.now();
  let finished = false;
  return {
    requestId,
    log: logging.logger(meta),
    finish(status: number): void {
      if (finished) return;
      finished = true;
      // Logging must never fail a response: record() is contractually non-throwing and the
      // runtime contains a broken sink (D-119).
      logging.record(
        createAccessEntry(meta, {
          status,
          durationMs: Math.round(performance.now() - startedAt),
        }),
      );
    },
    recordError(error: unknown, code: string): void {
      logging.record(createErrorEntry(meta, error, code));
    },
  };
}
