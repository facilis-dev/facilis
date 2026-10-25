import { describe, expect, it } from "vitest";

import { guardDevRequest, isOriginAllowed } from "./http-guard.ts";

function headers(init: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(init).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

describe("isOriginAllowed", () => {
  it("allows requests without an Origin header (same-origin GETs)", () => {
    expect(isOriginAllowed(headers({}))).toBe(true);
  });

  it("allows loopback origins on any port", () => {
    expect(isOriginAllowed(headers({ origin: "http://localhost:5173" }))).toBe(true);
    expect(isOriginAllowed(headers({ origin: "http://127.0.0.1:3000" }))).toBe(true);
    expect(isOriginAllowed(headers({ origin: "http://[::1]:4321" }))).toBe(true);
  });

  it("allows the request host itself", () => {
    expect(
      isOriginAllowed(
        headers({ origin: "https://preview.example.dev", host: "preview.example.dev" }),
      ),
    ).toBe(true);
  });

  it("rejects other origins", () => {
    expect(isOriginAllowed(headers({ origin: "https://evil.example" }))).toBe(false);
    expect(
      isOriginAllowed(headers({ origin: "https://evil.example", host: "preview.example.dev" })),
    ).toBe(false);
  });

  it("rejects opaque and malformed origins", () => {
    expect(isOriginAllowed(headers({ origin: "null" }))).toBe(false);
    expect(isOriginAllowed(headers({ origin: "not a url" }))).toBe(false);
  });
});

describe("guardDevRequest", () => {
  it("returns 404 in production", () => {
    const result = guardDevRequest(headers({}), { NODE_ENV: "production" });
    expect(result?.status).toBe(404);
    expect(result?.body).toEqual({ code: "not_found" });
  });

  it("returns 403 on an origin mismatch", () => {
    const result = guardDevRequest(headers({ origin: "https://evil.example" }), {
      NODE_ENV: "development",
    });
    expect(result?.status).toBe(403);
    expect(result?.body).toEqual({ code: "forbidden" });
  });

  it("allows a development request", () => {
    expect(guardDevRequest(headers({ origin: "http://localhost:5173" }), {})).toBeNull();
  });
});
