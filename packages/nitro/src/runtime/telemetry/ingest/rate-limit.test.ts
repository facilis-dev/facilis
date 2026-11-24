import { describe, expect, it } from "vitest";

import { clientIp, SpanRateLimiter } from "./rate-limit.ts";

describe("SpanRateLimiter", () => {
  it("allows up to the span/min capacity, then drops with retry-after", () => {
    let now = 1_000_000;
    const limiter = new SpanRateLimiter(3, () => now);
    expect(limiter.take("k", 1).allowed).toBe(true);
    expect(limiter.take("k", 1).allowed).toBe(true);
    expect(limiter.take("k", 1).allowed).toBe(true);
    const denied = limiter.take("k", 1);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.remaining).toBe(0);
    // 3 spans/min refills one token every 20 s.
    now += 20_000;
    expect(limiter.take("k", 1).allowed).toBe(true);
  });

  it("charges a whole batch at once and reports the wait for it", () => {
    const limiter = new SpanRateLimiter(10, () => 0);
    expect(limiter.take("k", 10).allowed).toBe(true);
    const denied = limiter.take("k", 5);
    expect(denied.allowed).toBe(false);
    // 5 spans at 10/min = 30 s.
    expect(denied.retryAfterSeconds).toBe(30);
  });

  it("keeps buckets per key and caps the refill at capacity", () => {
    let now = 0;
    const limiter = new SpanRateLimiter(2, () => now);
    expect(limiter.take("a", 2).allowed).toBe(true);
    expect(limiter.take("b", 2).allowed).toBe(true);
    expect(limiter.take("a", 1).allowed).toBe(false);
    now += 10 * 60_000;
    // A long idle refills to capacity, never beyond it.
    expect(limiter.take("a", 2).allowed).toBe(true);
    expect(limiter.take("a", 1).allowed).toBe(false);
  });

  it("evicts the oldest key once the map exceeds its bound", () => {
    const limiter = new SpanRateLimiter(1, () => 0);
    for (let i = 0; i <= 512; i += 1) {
      expect(limiter.take("key-" + i, 1).allowed).toBe(true);
    }
    // key-0 was evicted, so it starts from a fresh bucket again.
    expect(limiter.take("key-0", 1).allowed).toBe(true);
    // The newest keys still hold their exhausted buckets.
    expect(limiter.take("key-512", 1).allowed).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the first forwarded hop, trimmed", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it('is "unknown" without a usable header', () => {
    expect(clientIp(new Headers())).toBe("unknown");
    expect(clientIp(new Headers({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
