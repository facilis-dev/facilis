/**
 * In-process fixed-window rate limiter for the framework-owned token endpoint (D-143).
 *
 * A deployment runs one Nitro server process, so an in-memory window is enough to throttle a
 * secret-guessing loop; a multi-instance deployment would need a shared store, which the
 * framework does not ship and does not pretend to have. The limiter is deliberately tiny: the
 * token endpoint is the only caller, and one map of key → window does the job.
 */

export interface RateLimitWindow {
  readonly windowMs: number;
  readonly maxRequests: number;
}

/**
 * A denial carries the seconds to wait so the route can set `retry-after`; an allowed
 * decision has no reason to expose the window's arithmetic.
 */
export type RateLimitDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

interface WindowState {
  count: number;
  resetAt: number;
}

/** Sweep expired windows once the map grows past this many keys, so rotating keys can't grow it. */
const SWEEP_THRESHOLD = 1024;

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
        windows.set(key, { count: 1, resetAt: now + window.windowMs });
        if (windows.size > SWEEP_THRESHOLD) sweep(windows, now);
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

/** Drops windows that already reset; the current key was just inserted and is kept. */
function sweep(windows: Map<string, WindowState>, now: number): void {
  for (const [key, state] of windows) {
    if (state.resetAt <= now) windows.delete(key);
  }
}
