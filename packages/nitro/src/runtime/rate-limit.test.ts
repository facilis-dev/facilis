import { describe, expect, it } from "vitest";

import { createFixedWindowRateLimiter, type RateLimitWindow } from "./rate-limit.ts";

const WINDOW: RateLimitWindow = { windowMs: 60_000, maxRequests: 3 };

describe("createFixedWindowRateLimiter", () => {
  it("allows exactly maxRequests attempts and then denies with a retry-after", () => {
    const limiter = createFixedWindowRateLimiter();

    expect(limiter.consume("client-1", WINDOW, 0)).toEqual({ allowed: true });
    expect(limiter.consume("client-1", WINDOW, 1_000)).toEqual({ allowed: true });
    expect(limiter.consume("client-1", WINDOW, 2_000)).toEqual({ allowed: true });
    expect(limiter.consume("client-1", WINDOW, 3_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 57,
    });
  });

  it("opens a new window when the current one has elapsed", () => {
    const limiter = createFixedWindowRateLimiter();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(limiter.consume("client-1", WINDOW, 0)).toEqual({ allowed: true });
    }
    expect(limiter.consume("client-1", WINDOW, 60_000)).toEqual({ allowed: true });
  });

  it("keeps one window per key, so one client cannot exhaust another's budget", () => {
    const limiter = createFixedWindowRateLimiter();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(limiter.consume("client-1", WINDOW, 0)).toEqual({ allowed: true });
    }
    expect(limiter.consume("client-1", WINDOW, 0)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(limiter.consume("client-2", WINDOW, 0)).toEqual({ allowed: true });
  });

  it("never reports a zero-second wait and defaults to the wall clock", () => {
    const limiter = createFixedWindowRateLimiter();
    const now = Date.now();
    const window: RateLimitWindow = { windowMs: 1, maxRequests: 1 };

    expect(limiter.consume("client-1", window, now)).toEqual({ allowed: true });
    const denied = limiter.consume("client-1", window, now);
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: 1 });
    // The injectable clock only defaults when omitted; the real one is still wired.
    expect(limiter.consume("client-2", WINDOW)).toEqual({ allowed: true });
  });
});
