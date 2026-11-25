import { afterEach, describe, expect, it } from "vitest";
import type { Span, Tracer } from "@opentelemetry/api";
import { captureRumError, ERROR_SPAN_NAME, sanitizeErrorType, wireWindowErrors } from "./errors.ts";

const GLOBAL = globalThis as Record<string, unknown>;

describe("sanitizeErrorType", () => {
  it("keeps a clean constructor name", () => {
    expect(sanitizeErrorType(new TypeError("secret detail"))).toBe("TypeError");
    expect(sanitizeErrorType(new RangeError("x"))).toBe("RangeError");
    expect(sanitizeErrorType(new Error("x"))).toBe("Error");
  });

  it("collapses a malformed constructor name to Error", () => {
    class Bad extends Error {}
    Object.defineProperty(Bad, "name", { value: "bad name with spaces!" });
    expect(sanitizeErrorType(new Bad())).toBe("Error");
    class Long extends Error {}
    Object.defineProperty(Long, "name", { value: "A".repeat(100) });
    expect(sanitizeErrorType(new Long())).toBe("Error");
  });

  it("labels every non-Error reason NonError", () => {
    for (const reason of ["a string", 42, null, undefined, { message: "plain object" }]) {
      expect(sanitizeErrorType(reason)).toBe("NonError");
    }
  });
});

describe("captureRumError — disabled boot", () => {
  // Runs before any wiring in this file: the module tracer is still null.
  it("is a no-op when boot never wired a tracer", () => {
    expect(() => captureRumError(new Error("x"), "window.onerror")).not.toThrow();
  });
});

describe("window error wiring", () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const starts: { name: string; attributes: Record<string, unknown> }[] = [];
  const ended: string[] = [];
  const tracer = {
    startSpan: (name: string, options?: { attributes?: Record<string, unknown> }) => {
      starts.push({ name, attributes: options?.attributes ?? {} });
      return { end: () => ended.push(name) } as unknown as Span;
    },
  } as unknown as Tracer;

  afterEach(() => {
    delete GLOBAL["window"];
    handlers.clear();
    starts.length = 0;
    ended.length = 0;
  });

  function wire(): void {
    GLOBAL["window"] = {
      addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
    };
    wireWindowErrors(tracer);
  }

  it("reports window errors as type + source only, never the message", () => {
    wire();
    const handler = handlers.get("error");
    if (handler === undefined) throw new Error("error listener missing");
    handler({ error: new TypeError("user alice failed at secret.ts") });
    expect(starts).toHaveLength(1);
    expect(starts[0]?.name).toBe(ERROR_SPAN_NAME);
    expect(starts[0]?.attributes).toEqual({
      "error.type": "TypeError",
      "facilis.rum.source": "window.onerror",
    });
    expect(ended).toEqual([ERROR_SPAN_NAME]);
    expect(JSON.stringify(starts)).not.toContain("alice");
    expect(JSON.stringify(starts)).not.toContain("secret");
  });

  it("reports unhandled rejections, including non-Error reasons", () => {
    wire();
    const handler = handlers.get("unhandledrejection");
    if (handler === undefined) throw new Error("rejection listener missing");
    handler({ reason: "just a string" });
    expect(starts[0]?.attributes).toEqual({
      "error.type": "NonError",
      "facilis.rum.source": "unhandledrejection",
    });
    expect(JSON.stringify(starts)).not.toContain("just a string");
  });

  it("labels react-boundary captures with their source", () => {
    wire();
    captureRumError(new Error("boundary"), "react-boundary");
    expect(starts[0]?.attributes).toEqual({
      "error.type": "Error",
      "facilis.rum.source": "react-boundary",
    });
  });
});
