/**
 * The framework rate limiter lives in @facilis.dev/core, where the authorized-handler wrapper uses
 * it (D-152). This module keeps the framework-owned token endpoint's import path stable and
 * re-exports exactly the same implementation, so both surfaces share one bounded limiter type.
 */
export {
  createFixedWindowRateLimiter,
  MAX_WINDOWS,
  type FixedWindowRateLimiter,
  type RateLimitDecision,
  type RateLimitWindow,
} from "@facilis.dev/core";
