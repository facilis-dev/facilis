/**
 * In-process fixed-window rate limiter shared by the authorized-handler wrapper and the
 * framework-owned token endpoint (D-143, D-152).
 *
 * A deployment runs one Nitro server process, so an in-memory window is enough to throttle a
 * secret-guessing loop; a multi-instance deployment would need a shared store, which the
 * framework does not ship and does not pretend to have. The limiter is deliberately tiny: a map
 * of key → window, bounded so rotating keys cannot grow it.
 */

import { fail } from "./errors.ts";
import type { FacilisRequestEvent } from "./event.ts";

export interface RateLimitWindow {
  readonly windowMs: number;
  readonly maxRequests: number;
}

/**
 * A denial carries the seconds to wait so the caller can set `retry-after`; an allowed decision
 * has no reason to expose the window's arithmetic.
 */
export type RateLimitDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

interface WindowState {
  count: number;
  resetAt: number;
}

/** Hard cap on tracked keys; the oldest window is evicted so rotating keys cannot grow the map. */
export const MAX_WINDOWS = 4096;

export interface FixedWindowRateLimiter {
  /** Counts one attempt for `key`; `now` is injectable for tests. */
  consume(key: string, window: RateLimitWindow, now?: number): RateLimitDecision;
}

export function createFixedWindowRateLimiter(): FixedWindowRateLimiter {
  const windows = new Map<string, WindowState>();

  return {
    consume(key, window, now = Date.now()) {
      const current = windows.get(key);
      if (current === undefined || now >= current.resetAt) {
        // FIFO eviction: Map preserves insertion order, so the bound stays O(1) and an attacker
        // rotating keys pays one eviction per request instead of a full sweep (SEC-08).
        if (windows.size >= MAX_WINDOWS) {
          const oldest = windows.keys().next().value;
          if (oldest !== undefined) windows.delete(oldest);
        }
        windows.set(key, { count: 1, resetAt: now + window.windowMs });
        return { allowed: true };
      }
      if (current.count >= window.maxRequests) {
        // Ceil so a sub-second remainder still tells the caller to wait at least one second.
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        };
      }
      current.count += 1;
      return { allowed: true };
    },
  };
}

/**
 * One process-wide limiter for every wrapped route: the key already carries the method and path,
 * so two routes never share a window while the bounded eviction stays one concern (D-152).
 */
const routeRateLimiter = createFixedWindowRateLimiter();

/**
 * The authorized-handler throttle (D-152). Returns `undefined` when the request may proceed —
 * including when the deployment resolved no client address: without an honest per-client key the
 * route is not throttled rather than having every caller share one window. A denial is a ready
 * `429` Response carrying `retry-after`, so the wrapper only has to record and return it.
 */
export function throttleRouteRequest(
  event: FacilisRequestEvent,
  window: RateLimitWindow,
  clientAddress: string | undefined,
): Response | undefined {
  if (clientAddress === undefined) return undefined;
  const decision = routeRateLimiter.consume(rateLimitKey(event, clientAddress), window);
  if (decision.allowed) return undefined;
  const response = fail("too_many_requests");
  response.headers.set("retry-after", String(decision.retryAfterSeconds));
  return response;
}

/** `METHOD path address`: the window is per client and per route, never across routes. */
function rateLimitKey(event: FacilisRequestEvent, address: string): string {
  const raw = event.req.url;
  let path = "/";
  if (typeof raw === "string") {
    try {
      path = new URL(raw).pathname;
    } catch {
      // A path-only URL (Nitro can hand one over) cannot be parsed; the whole value is the key.
      path = raw.split("?")[0] ?? raw;
    }
  }
  return `${event.req.method ?? "GET"} ${path} ${address}`;
}
