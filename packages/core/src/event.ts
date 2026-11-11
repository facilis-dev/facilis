import type { AuthContext } from "@facilis.dev/auth";
import type { FacilisDb } from "@facilis.dev/db";

import type { JobsApi } from "./jobs.ts";
import type { TasksApi } from "./tasks.ts";
import type { WorkflowsApi } from "./workflows.ts";
import type { FacilisLoggingApi } from "./logging.ts";
import type { StorageApi } from "./storage.ts";

/**
 * Structural request/response surface owned by core (contracts §4.1).
 *
 * Core, auth and db must never import h3/nitro/vite; Nitro's `H3Event` satisfies these
 * shapes structurally, so middleware and handlers can share one event contract.
 */

export interface FacilisRequest {
  headers: Headers;
  /** Absolute request URL; h3 exposes it via `event.req.url` (a web `Request`). */
  readonly url?: string;
  readonly method?: string;
  /** Standard Fetch body reader; declared optional because only body-validated routes use it. */
  json?(): Promise<unknown>;
  /** Multipart reader; routes with a `form` schema get this consumed by the wrapper. */
  formData?(): Promise<FormData>;
}

export interface FacilisEventContext {
  /** Set by session middleware; `null`/absent means anonymous (contracts §4.1). */
  auth?: AuthContext | null;
  /** Set by the facilis-context middleware before any route runs. */
  facilis?: {
    db: FacilisDb;
    /** Single-tenant fallback scope for unauthenticated requests (registration/login). */
    defaultTenantId?: string;
    /** Server-only background-job API, started by the same middleware (D-107). */
    jobs?: JobsApi;
    /** Server-only manual-task API (D-135): request, list and decide durable human tasks. */
    tasks?: TasksApi;
    /** Server-only workflow API (D-135): start, inspect and cancel job/approval chains. */
    workflows?: WorkflowsApi;
    /** Binary-storage runtime, started by the same middleware (D-053). */
    storage?: StorageApi;
    /** Request logging runtime (D-119): sink, buffer and per-request logger factory. */
    logging?: FacilisLoggingApi;
    /** Correlation id for this request; the logging middleware sets it before routes run. */
    requestId?: string;
    /** Client metadata the middleware resolved (proxy trust is its decision, not core's). */
    client?: {
      readonly ip?: string;
      readonly userAgent?: string;
    };
    /**
     * Client address used to key the wrapper's rate limit (D-152). It is resolved by the
     * middleware with the deployment's proxy-trust decision, independent of the logging
     * opt-ins: an address that is not trusted to identify the caller is not logged and is not
     * used to split a rate-limit window.
     */
    clientAddress?: string;
  };
  /**
   * Origin policy decided by the context middleware: the request-origin gate reads the
   * trusted allow-list from here, and the wrapper is the only consumer.
   */
  security?: {
    readonly trustedOrigins: readonly string[];
  };
  /** Router params populated by Nitro (h3 `event.context.params`). */
  params?: Record<string, string>;
}

/**
 * The response surface of a handler (contracts §4.4). h3 merges it into the final response:
 * `headers` are merged (`set-cookie` appended, every other name overrides) and
 * `status`/`statusText` apply to handlers that return plain data — a returned `Response`
 * keeps its own status, but its headers are still merged under these.
 */
export interface FacilisResponse {
  headers: Headers;
  status?: number;
  statusText?: string;
}

export interface FacilisRequestEvent {
  context: FacilisEventContext;
  req: FacilisRequest;
  res?: FacilisResponse;
}

/**
 * The handler-visible context: the middleware state minus the raw database client.
 *
 * The root Drizzle client lives only in `FacilisEventContext.facilis.db`, which
 * `defineAuthorizedHandler` captures before the project handler runs. A handler sees just
 * `ctx.db` (policy-scoped) and the audited sudo/system wrappers, so a raw, policy-free
 * client is not reachable from the handler surface at all (D-099, structural not convention).
 */
export interface FacilisHandlerContext {
  auth?: AuthContext | null;
  facilis?: {
    /** Single-tenant fallback scope for unauthenticated requests (registration/login). */
    defaultTenantId?: string;
  };
  params?: Record<string, string>;
}

/** The event a route handler receives; share `req`/`res` with the outer request event. */
export interface FacilisHandlerEvent {
  context: FacilisHandlerContext;
  req: FacilisRequest;
  res?: FacilisResponse;
}

export type FacilisContext = FacilisEventContext;
