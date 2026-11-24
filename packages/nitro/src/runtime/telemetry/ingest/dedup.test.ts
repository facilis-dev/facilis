import { describe, expect, it } from "vitest";

import { SpanDeduplicator } from "./dedup.ts";

const TRACE = "a".repeat(32);

describe("SpanDeduplicator", () => {
  it("accepts a span once and rejects the replay", () => {
    const dedup = new SpanDeduplicator();
    expect(dedup.accept(TRACE, "1".repeat(16))).toBe(true);
    expect(dedup.accept(TRACE, "1".repeat(16))).toBe(false);
    // A different span id in the same trace is a different span.
    expect(dedup.accept(TRACE, "2".repeat(16))).toBe(true);
  });

  it("forgets entries once their TTL expired", () => {
    let now = 0;
    const dedup = new SpanDeduplicator(1000, () => now);
    expect(dedup.accept(TRACE, "1".repeat(16))).toBe(true);
    now = 999;
    expect(dedup.accept(TRACE, "1".repeat(16))).toBe(false);
    now = 1001;
    expect(dedup.accept(TRACE, "1".repeat(16))).toBe(true);
  });

  it("bounds the map, evicting expired entries first and then the oldest", () => {
    let now = 0;
    const dedup = new SpanDeduplicator(1000, () => now);
    for (let i = 0; i < 4096; i += 1) {
      expect(dedup.accept(TRACE, i.toString(16).padStart(16, "0"))).toBe(true);
    }
    // The map is at capacity: the next accept prunes/evicts but still accepts the new id.
    now = 2000;
    expect(dedup.accept(TRACE, "f".repeat(16))).toBe(true);
    // Everything expired at now=2000 was pruned, so an old id is accepted again.
    expect(dedup.accept(TRACE, "0".repeat(16))).toBe(true);
  });
});
