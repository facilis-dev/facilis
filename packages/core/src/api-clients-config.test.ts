import { describe, expect, it } from "vitest";

import { defineConfig } from "./config.ts";

const AUTH = { defaultRole: "user", roles: { user: [] }, permissions: [] } as const;

function configWith(apiClients: unknown) {
  return defineConfig({ auth: { ...AUTH, apiClients } as never });
}

describe("auth.apiClients", () => {
  it("accepts an explicit override and fills the rate limit default", () => {
    const config = defineConfig({
      auth: { ...AUTH, apiClients: { enabled: true, tokenTtlMs: 60_000 } },
    });

    expect(config.auth.apiClients).toEqual({
      enabled: true,
      tokenTtlMs: 60_000,
      rateLimit: { windowMs: 60_000, maxRequests: 30 },
    });
  });

  it("accepts an explicit token rate limit", () => {
    const config = defineConfig({
      auth: { ...AUTH, apiClients: { rateLimit: { windowMs: 10_000, maxRequests: 3 } } },
    });

    expect(config.auth.apiClients.rateLimit).toEqual({ windowMs: 10_000, maxRequests: 3 });
    // The other keys keep their defaults: rate limiting is independent of enabling the route.
    expect(config.auth.apiClients).toMatchObject({ enabled: false, tokenTtlMs: 3_600_000 });
  });

  it("rejects invalid values instead of dropping them", () => {
    // Zero, negative and fractional lifetimes are not usable token TTLs.
    expect(() => configWith({ tokenTtlMs: 0 })).toThrow(/tokenTtlMs/);
    expect(() => configWith({ tokenTtlMs: -1 })).toThrow(/tokenTtlMs/);
    expect(() => configWith({ tokenTtlMs: 1.5 })).toThrow(/tokenTtlMs/);
    expect(() => configWith({ enabled: "yes" })).toThrow(/enabled/);
    expect(() => configWith({ rateLimit: { windowMs: 0, maxRequests: 10 } })).toThrow(/windowMs/);
    expect(() => configWith({ rateLimit: { windowMs: 1000, maxRequests: 0 } })).toThrow(
      /maxRequests/,
    );
    // strictObject: a typo must not be silently dropped.
    expect(() => configWith({ enabled: true, tokenTtlMs: 1000, ttl: 1000 })).toThrow(
      /Unrecognized key/,
    );
    expect(() => configWith({ rateLimit: { max: 3 } })).toThrow(/Unrecognized key/);
  });
});
