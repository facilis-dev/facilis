import { describe, expect, it, vi } from "vitest";
import type { Span, Tracer } from "@opentelemetry/api";

// The real web-vitals observers need a browser; capture the callbacks instead and drive
// them by hand with fixture metrics (the node environment has no PerformanceObserver entries).
vi.mock("web-vitals", () => ({
  onLCP: vi.fn(),
  onINP: vi.fn(),
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onTTFB: vi.fn(),
}));
import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import type { Metric } from "web-vitals";
import { mapVital, WEB_VITAL_SPAN_NAME, wireVitals } from "./vitals.ts";

function metric(name: Metric["name"], value: number, rating: Metric["rating"]): Metric {
  return {
    name,
    value,
    rating,
    delta: value,
    entries: [],
    id: "v1-1",
    navigationType: "navigate",
  };
}

describe("mapVital — the pinned browser.web_vital semconv triple", () => {
  it("maps name/value/rating and nothing else", () => {
    expect(mapVital(metric("LCP", 2500.5, "good"))).toEqual({
      "browser.web_vital.name": "LCP",
      "browser.web_vital.value": 2500.5,
      "browser.web_vital.rating": "good",
    });
    expect(mapVital(metric("CLS", 0.05, "needs-improvement"))).toEqual({
      "browser.web_vital.name": "CLS",
      "browser.web_vital.value": 0.05,
      "browser.web_vital.rating": "needs-improvement",
    });
  });
});

describe("wireVitals", () => {
  it("registers all five vitals and emits one ended span per report", () => {
    const ended: string[] = [];
    const starts: { name: string; attributes: Record<string, unknown> }[] = [];
    const tracer = {
      startSpan: (name: string, options?: { attributes?: Record<string, unknown> }) => {
        starts.push({ name, attributes: options?.attributes ?? {} });
        return { end: () => ended.push(name) } as unknown as Span;
      },
    } as unknown as Tracer;

    wireVitals(tracer);
    const hooks = [onLCP, onINP, onCLS, onFCP, onTTFB];
    for (const hook of hooks) expect(hook).toHaveBeenCalledTimes(1);

    const names: Metric["name"][] = ["LCP", "INP", "CLS", "FCP", "TTFB"];
    hooks.forEach((hook, index) => {
      const name = names[index];
      // Each hook's callback takes its own metric subtype; the fixture carries the shared
      // base shape, which is all mapVital reads.
      const callback = vi.mocked(hook).mock.calls[0]?.[0] as ((metric: Metric) => void) | undefined;
      if (callback === undefined || name === undefined) throw new Error("vital callback missing");
      callback(metric(name, index + 1, "good"));
    });

    expect(starts).toHaveLength(5);
    expect(ended).toHaveLength(5);
    for (const start of starts) {
      expect(start.name).toBe(WEB_VITAL_SPAN_NAME);
      expect(Object.keys(start.attributes).toSorted()).toEqual([
        "browser.web_vital.name",
        "browser.web_vital.rating",
        "browser.web_vital.value",
      ]);
    }
    expect(starts[0]?.attributes["browser.web_vital.name"]).toBe("LCP");
    expect(starts[4]?.attributes["browser.web_vital.name"]).toBe("TTFB");
  });
});
