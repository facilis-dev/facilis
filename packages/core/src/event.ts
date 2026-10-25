import type { AuthContext } from "@facilis/auth";
import type { FacilisDb } from "@facilis/db";

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
}

export interface FacilisEventContext {
  /** Set by session middleware; `null`/absent means anonymous (contracts §4.1). */
  auth?: AuthContext | null;
  /** Set by the facilis-context middleware before any route runs. */
  facilis?: {
    db: FacilisDb;
    /** Single-tenant fallback scope for unauthenticated requests (registration/login). */
    defaultTenantId?: string;
  };
  /** Router params populated by Nitro (h3 `event.context.params`). */
  params?: Record<string, string>;
}

export interface FacilisRequestEvent {
  context: FacilisEventContext;
  req: FacilisRequest;
  res?: { headers: Headers };
}

export type FacilisContext = FacilisEventContext;
