import { describe, expect, it } from "vitest";

import { isAllowedOrigin, requestOrigin } from "./origin.ts";

const ALLOWED = ["https://app.acme.example", "http://localhost:5173"];

describe("isAllowedOrigin", () => {
  it("accepts an exact scheme+host+port match", () => {
    expect(isAllowedOrigin(ALLOWED, "https://app.acme.example")).toBe(true);
    expect(isAllowedOrigin(ALLOWED, "http://localhost:5173")).toBe(true);
    // A trailing slash on the header value is the same origin.
    expect(isAllowedOrigin(ALLOWED, "https://app.acme.example/")).toBe(true);
  });

  it("rejects any scheme, host or port mismatch", () => {
    for (const origin of [
      "http://app.acme.example",
      "https://app.acme.example:443",
      "https://evil.acme.example",
      "https://app.acme.example.evil.example",
      "http://localhost:5174",
      "https://localhost:5173",
    ]) {
      expect(isAllowedOrigin(ALLOWED, origin)).toBe(false);
    }
  });

  it('rejects "null", wildcard, empty and missing origins', () => {
    for (const origin of ["null", "*", "https://*.acme.example", "", null]) {
      expect(isAllowedOrigin(ALLOWED, origin)).toBe(false);
    }
    // Even a configured wildcard entry never admits anything.
    expect(isAllowedOrigin(["*"], "https://app.acme.example")).toBe(false);
  });

  it("rejects everything when the allowlist is empty", () => {
    expect(isAllowedOrigin([], "https://app.acme.example")).toBe(false);
  });
});

describe("requestOrigin", () => {
  const headers = (entries: Record<string, string>): Headers => new Headers(entries);

  it("uses the absolute request URL when Nitro provides one", () => {
    expect(requestOrigin("https://app.acme.example/api/x", headers({}))).toBe(
      "https://app.acme.example",
    );
  });

  it("falls back to the Host header for a path-only URL", () => {
    expect(
      requestOrigin("/__facilis/telemetry/v1/traces", headers({ host: "app.acme.example" })),
    ).toBe("http://app.acme.example");
  });

  it("honours the proxy's forwarded protocol", () => {
    expect(
      requestOrigin(
        "/x",
        headers({ host: "app.acme.example", "x-forwarded-proto": "https" }),
      ),
    ).toBe("https://app.acme.example");
  });

  it("returns null when neither the URL nor the Host header yields an origin", () => {
    expect(requestOrigin("/x", headers({}))).toBeNull();
    expect(requestOrigin("/x", headers({ host: "not a host" }))).toBeNull();
    expect(requestOrigin("ftp://app.acme.example/x", headers({}))).toBeNull();
  });
});
