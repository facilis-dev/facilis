export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly remaining: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const MAX_KEYS = 512;

/**
 * Token bucket charged in SPANS per minute (spec §8.8). The pre-parse probe takes one token
 * so a flood is stopped before its body is read; the post-parse charge covers the batch size,
 * so the span/min cap holds too.
 */
export class SpanRateLimiter {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  readonly #buckets = new Map<string, Bucket>();
  readonly #now: () => number;

  constructor(spansPerMinute: number, now: () => number = Date.now) {
    this.#capacity = spansPerMinute;
    this.#refillPerMs = spansPerMinute / 60_000;
    this.#now = now;
  }

  take(key: string, cost: number): RateLimitDecision {
    const now = this.#now();
    const bucket = this.#buckets.get(key) ?? { tokens: this.#capacity, updatedAt: now };
    const tokens = Math.min(
      this.#capacity,
      bucket.tokens + (now - bucket.updatedAt) * this.#refillPerMs,
    );
    if (tokens < cost) {
      const waitMs = (cost - tokens) / this.#refillPerMs;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
        remaining: 0,
      };
    }
    this.#buckets.set(key, { tokens: tokens - cost, updatedAt: now });
    if (this.#buckets.size > MAX_KEYS) {
      const oldest = this.#buckets.keys().next().value;
      if (oldest !== undefined) {
        this.#buckets.delete(oldest);
      }
    }
    return { allowed: true, retryAfterSeconds: 0, remaining: Math.floor(tokens - cost) };
  }
}
