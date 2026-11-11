import { z } from "zod";

/**
 * Programmatic API clients (V3a): `auth.apiClients`. Opt-in, because a project that never
 * needs machine credentials should not expose an API-client surface at all.
 */

/** Rate limit of the framework token endpoint, per client id (D-143). */
export interface FacilisApiClientsRateLimitConfig {
  /** Window the exchange count is measured over. */
  readonly windowMs: number;
  /** Token exchanges allowed per client id in one window. */
  readonly maxRequests: number;
}

export interface FacilisApiClientsConfig {
  readonly enabled: boolean;
  /** Lifetime of an issued access token: a positive whole number of milliseconds. */
  readonly tokenTtlMs: number;
  /** Per-client limit of the token endpoint (D-143); in-process and per-window. */
  readonly rateLimit: FacilisApiClientsRateLimitConfig;
}

/** Authored form of `auth.apiClients`: every key has the framework default. */
export interface FacilisApiClientsConfigInput {
  readonly enabled?: boolean;
  readonly tokenTtlMs?: number;
  readonly rateLimit?: {
    readonly windowMs?: number;
    readonly maxRequests?: number;
  };
}

const DEFAULT_API_TOKEN_TTL_MS = 1000 * 60 * 60;

// A client may exchange its secret 30 times a minute: token lifetimes are an hour, so a
// legitimate caller renews once, while a secret-guessing loop is throttled to a crawl.
const DEFAULT_API_CLIENT_RATE_LIMIT = { windowMs: 60_000, maxRequests: 30 };

// API clients are opt-in (disabled by default) and their token lifetime is a whole positive
// number of milliseconds: one hour, short enough that a leaked token ages out quickly.
const DEFAULT_API_CLIENTS_CONFIG = {
  enabled: false,
  tokenTtlMs: DEFAULT_API_TOKEN_TTL_MS,
  rateLimit: DEFAULT_API_CLIENT_RATE_LIMIT,
};

export const apiClientsSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    tokenTtlMs: z.number().int().positive().default(DEFAULT_API_TOKEN_TTL_MS),
    rateLimit: z
      .strictObject({
        windowMs: z.number().int().positive().default(DEFAULT_API_CLIENT_RATE_LIMIT.windowMs),
        maxRequests: z.number().int().positive().default(DEFAULT_API_CLIENT_RATE_LIMIT.maxRequests),
      })
      .default(() => DEFAULT_API_CLIENT_RATE_LIMIT),
  })
  .default(() => DEFAULT_API_CLIENTS_CONFIG);
