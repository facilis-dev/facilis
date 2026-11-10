import { issueApiToken } from "@facilis/auth";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import { z } from "zod";

import { getBootstrap } from "../runtime/bootstrap.ts";
import { jsonResult, toResponse } from "../runtime/http.ts";
import { createFixedWindowRateLimiter } from "../runtime/rate-limit.ts";

// One limiter per process: the window is per client id, and a deployment runs one server.
const tokenRateLimiter = createFixedWindowRateLimiter();

const tokenRequestSchema = z.object({
  grant_type: z.literal("client_credentials"),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

/**
 * POST /api/auth/token — framework-owned OAuth2 client-credentials endpoint (v3a).
 *
 * A machine client exchanges its id + secret for a short-lived Bearer token; the route is
 * public (no session), and a disabled config answers not_found so a deployment that does not
 * use API clients exposes no enumerable surface. The wrapper enforces the JSON content-type
 * and validates the body; the secret is never logged.
 */
export default defineAuthorizedHandler(
  {
    permission: [],
    // The issue path reads the client row and inserts the token; the service user is reached
    // through the client's RLS policy, not by a query of this route.
    dbTables: ["api_clients", "api_tokens"],
    body: tokenRequestSchema,
    description: "Framework-owned OAuth2 client-credentials token endpoint.",
  },
  async (_event, ctx) => {
    const state = await getBootstrap();
    const config = state.config;
    if (config === null) return fail("db_unavailable");
    // v3a: a deployment with no API clients keeps the route registered but invisible.
    if (config.auth.apiClients?.enabled !== true) return fail("not_found");

    // Throttle before touching the database: this is where a secret-guessing loop would
    // otherwise reach a hash comparison on every attempt (D-143).
    const limit = tokenRateLimiter.consume(ctx.body.client_id, config.auth.apiClients.rateLimit);
    if (!limit.allowed) {
      ctx.log.audit({
        operation: "auth:token:issue",
        outcome: "failed",
        errorCode: "too_many_requests",
      });
      const response = fail("too_many_requests");
      response.headers.set("retry-after", String(limit.retryAfterSeconds));
      return response;
    }

    const issued = await issueApiToken(ctx.db, {
      clientId: ctx.body.client_id,
      clientSecret: ctx.body.client_secret,
      ttlMs: config.auth.apiClients.tokenTtlMs,
    });
    if (issued === null) {
      ctx.log.audit({
        operation: "auth:token:issue",
        outcome: "failed",
        errorCode: "unauthorized",
      });
      return fail("unauthorized");
    }

    // Only the client id is auditable: the secret and the issued token are credentials.
    ctx.log.audit({
      operation: "auth:token:issue",
      outcome: "succeeded",
      details: { clientId: ctx.body.client_id },
    });
    return toResponse(
      jsonResult(
        200,
        {
          access_token: issued.accessToken,
          token_type: "Bearer",
          // A response body is not a cache surface (D-119): the token must never be stored.
          expires_in: Math.floor(config.auth.apiClients.tokenTtlMs / 1000),
        },
        { "cache-control": "no-store" },
      ),
    );
  },
);
