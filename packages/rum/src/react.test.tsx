import { afterEach, describe, expect, it } from "vitest";
import type { Span, Tracer } from "@opentelemetry/api";
import { wireWindowErrors } from "./errors.ts";
import { RumErrorBoundary } from "./react.tsx";

const GLOBAL = globalThis as Record<string, unknown>;

afterEach(() => {
  delete GLOBAL["window"];
});

describe("RumErrorBoundary — render logic (no DOM needed)", () => {
  it("renders children while healthy", () => {
    const boundary = new RumErrorBoundary({ children: "the app" });
    expect(boundary.state).toEqual({ hasError: false });
    expect(boundary.render()).toBe("the app");
  });

  it("getDerivedStateFromError flips hasError", () => {
    expect(RumErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });

  it("renders null after an error when no fallback is provided (report-only)", () => {
    const boundary = new RumErrorBoundary({ children: "the app" });
    boundary.state = RumErrorBoundary.getDerivedStateFromError();
    expect(boundary.render()).toBeNull();
  });

  it("renders the caller-provided fallback after an error", () => {
    const fallback = "caller-owned fallback";
    const boundary = new RumErrorBoundary({ children: "the app", fallback });
    boundary.state = RumErrorBoundary.getDerivedStateFromError();
    expect(boundary.render()).toBe(fallback);
  });
});

describe("RumErrorBoundary — reporting", () => {
  it("componentDidCatch reports type + react-boundary source, never the message", () => {
    const starts: { name: string; attributes: Record<string, unknown> }[] = [];
    const tracer = {
      startSpan: (name: string, options?: { attributes?: Record<string, unknown> }) => {
        starts.push({ name, attributes: options?.attributes ?? {} });
        return { end: () => {} } as unknown as Span;
      },
    } as unknown as Tracer;
    GLOBAL["window"] = { addEventListener: () => {} };
    wireWindowErrors(tracer);

    const boundary = new RumErrorBoundary({ children: null });
    boundary.componentDidCatch(new TypeError("user alice failed"));
    expect(starts).toHaveLength(1);
    expect(starts[0]?.name).toBe("browser.error");
    expect(starts[0]?.attributes).toEqual({
      "error.type": "TypeError",
      "facilis.rum.source": "react-boundary",
    });
    expect(JSON.stringify(starts)).not.toContain("alice");
  });

  it("componentDidCatch accepts non-Error reasons without throwing", () => {
    const boundary = new RumErrorBoundary({ children: null });
    expect(() => boundary.componentDidCatch("a string reason")).not.toThrow();
  });
});
