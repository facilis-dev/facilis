import { describe, expect, it } from "vitest";
import { isAtBottom, type ScrollMetrics } from "./chat-scroll";

function metrics(overrides: Partial<ScrollMetrics> = {}): ScrollMetrics {
  return { scrollTop: 900, clientHeight: 400, scrollHeight: 1300, ...overrides };
}

describe("isAtBottom", () => {
  it("is true exactly at the end", () => {
    expect(isAtBottom(metrics())).toBe(true);
  });

  it("tolerates the last few pixels", () => {
    expect(isAtBottom(metrics({ scrollTop: 884 }))).toBe(true);
  });

  it("is false once the reader scrolled up to read", () => {
    expect(isAtBottom(metrics({ scrollTop: 400 }))).toBe(false);
  });

  it("is true when the content does not overflow", () => {
    expect(isAtBottom({ scrollTop: 0, clientHeight: 400, scrollHeight: 320 })).toBe(true);
  });

  it("honours a wider slack", () => {
    expect(isAtBottom(metrics({ scrollTop: 800 }), 120)).toBe(true);
    expect(isAtBottom(metrics({ scrollTop: 800 }), 80)).toBe(false);
  });
});
