import { describe, expect, it } from "vitest";

import {
  isRequestOriginAllowed,
  isUnsafeMethod,
  type RequestOriginPolicy,
} from "./request-security.ts";

interface PolicyOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly trustedOrigins?: readonly string[];
  readonly crossSite?: boolean;
}

function makePolicy(options: PolicyOptions = {}): RequestOriginPolicy {
  return {
    // Unsafe by default: the interesting cases are all POST/PUT/PATCH/DELETE.
    method: options.method ?? "POST",
    headers: new Headers(options.headers ?? {}),
    trustedOrigins: options.trustedOrigins ?? [],
    crossSite: options.crossSite ?? false,
  };
}

describe("isUnsafeMethod", () => {
  it.each(["post", "PUT", "Patch", "delete"])("treats %s as unsafe", (method) => {
    expect(isUnsafeMethod(method)).toBe(true);
  });

  it.each([undefined, "GET", "head", "OPTIONS"])("treats %s as safe", (method) => {
    expect(isUnsafeMethod(method)).toBe(false);
  });
});

describe("isRequestOriginAllowed", () => {
  it("allows safe methods regardless of the origin headers", () => {
    const policy = makePolicy({
      method: "GET",
      headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    });

    expect(isRequestOriginAllowed(policy)).toBe(true);
  });

  it("allows a cross-site request only for a crossSite route", () => {
    const headers = { "sec-fetch-site": "cross-site" };

    expect(isRequestOriginAllowed(makePolicy({ headers }))).toBe(false);
    expect(isRequestOriginAllowed(makePolicy({ headers, crossSite: true }))).toBe(true);
  });

  it("allows same-origin and no-initiator requests", () => {
    expect(
      isRequestOriginAllowed(makePolicy({ headers: { "sec-fetch-site": "same-origin" } })),
    ).toBe(true);
    expect(isRequestOriginAllowed(makePolicy({ headers: { "sec-fetch-site": "none" } }))).toBe(
      true,
    );
  });

  it("allows a same-site request only when its origin is trusted", () => {
    const headers = {
      "sec-fetch-site": "same-site",
      origin: "https://app.example.com",
    };

    expect(isRequestOriginAllowed(makePolicy({ headers }))).toBe(false);
    expect(
      isRequestOriginAllowed(makePolicy({ headers, trustedOrigins: ["https://app.example.com"] })),
    ).toBe(true);
  });

  it("never trusts the literal null origin", () => {
    const headers = { origin: "null" };

    expect(isRequestOriginAllowed(makePolicy({ headers }))).toBe(false);
    expect(
      isRequestOriginAllowed(makePolicy({ headers, trustedOrigins: ["null", "https://x.test"] })),
    ).toBe(false);
    expect(
      isRequestOriginAllowed(
        makePolicy({ headers: { "sec-fetch-site": "same-site", origin: "null" } }),
      ),
    ).toBe(false);
  });

  it("allows a request with neither origin nor Sec-Fetch-Site as a non-browser client", () => {
    expect(isRequestOriginAllowed(makePolicy())).toBe(true);
    expect(isRequestOriginAllowed(makePolicy({ headers: { origin: "" } }))).toBe(true);
  });

  it("compares Origin with the request Host including the port", () => {
    expect(
      isRequestOriginAllowed(
        makePolicy({ headers: { origin: "http://localhost:3000", host: "localhost:3000" } }),
      ),
    ).toBe(true);
    expect(
      isRequestOriginAllowed(
        makePolicy({ headers: { origin: "http://localhost:3000", host: "localhost:4000" } }),
      ),
    ).toBe(false);
  });

  it("denies a foreign Origin and a missing or malformed Host", () => {
    expect(
      isRequestOriginAllowed(
        makePolicy({ headers: { origin: "https://evil.example", host: "localhost:3000" } }),
      ),
    ).toBe(false);
    expect(
      isRequestOriginAllowed(makePolicy({ headers: { origin: "https://evil.example" } })),
    ).toBe(false);
    expect(
      isRequestOriginAllowed(
        makePolicy({ headers: { origin: "https://evil.example", host: "bad host" } }),
      ),
    ).toBe(false);
  });

  it("allows an Origin that is in the trusted allow-list", () => {
    expect(
      isRequestOriginAllowed(
        makePolicy({
          headers: { origin: "https://app.example.com", host: "other.test" },
          trustedOrigins: ["https://app.example.com"],
        }),
      ),
    ).toBe(true);
  });

  it("ignores trusted entries that do not parse as origins", () => {
    const headers = { origin: "https://app.example.com" };

    expect(isRequestOriginAllowed(makePolicy({ headers, trustedOrigins: ["not-a-url"] }))).toBe(
      false,
    );
    expect(
      isRequestOriginAllowed(makePolicy({ headers, trustedOrigins: ["ftp://app.example.com"] })),
    ).toBe(false);
    // Entries are compared as URL.origin; the config schema rejects a path at boot.
    expect(
      isRequestOriginAllowed(makePolicy({ headers, trustedOrigins: ["https://app.example.com"] })),
    ).toBe(true);
  });

  it("treats an unknown Sec-Fetch-Site value as absent and falls back to Origin", () => {
    expect(
      isRequestOriginAllowed(
        makePolicy({
          headers: {
            "sec-fetch-site": "banana",
            origin: "http://localhost:3000",
            host: "localhost:3000",
          },
        }),
      ),
    ).toBe(true);
    expect(
      isRequestOriginAllowed(
        makePolicy({
          headers: {
            "sec-fetch-site": "banana",
            origin: "https://evil.example",
            host: "localhost:3000",
          },
        }),
      ),
    ).toBe(false);
  });
});
