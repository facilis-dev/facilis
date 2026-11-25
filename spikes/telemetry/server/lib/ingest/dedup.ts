const MAX_ENTRIES = 4096;

/**
 * Span-id dedup (spec §8.8) so a replayed payload does not inflate the operator's backend.
 * Entries expire: the window only has to blunt naive replay, not be a security boundary.
 */
export class SpanDeduplicator {
  readonly #seen = new Map<string, number>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(ttlMs = 5 * 60_000, now: () => number = Date.now) {
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  accept(traceId: string, spanId: string): boolean {
    const now = this.#now();
    this.#prune(now);
    const key = traceId + spanId;
    if (this.#seen.has(key)) {
      return false;
    }
    this.#seen.set(key, now + this.#ttlMs);
    return true;
  }

  #prune(now: number): void {
    if (this.#seen.size < MAX_ENTRIES) {
      return;
    }
    for (const [key, expiresAt] of this.#seen) {
      if (expiresAt <= now) {
        this.#seen.delete(key);
      }
    }
    while (this.#seen.size >= MAX_ENTRIES) {
      const oldest = this.#seen.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#seen.delete(oldest);
    }
  }
}
