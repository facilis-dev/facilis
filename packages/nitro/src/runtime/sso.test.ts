import { describe, expect, it } from "vitest";
import { defineConfig, type FacilisHandlerEvent } from "@facilis/core";

import {
  listSsoProviders,
  resolvePublicOrigin,
  SSO_ROUTE_TABLES,
  ssoFailureLocation,
} from "./sso.ts";
import { SsoError } from "@facilis/auth";

const config = defineConfig({
  auth: {
    defaultRole: "user",
    roles: { user: [] },
    sso: {
      failureRedirect: "/login?from=sso",
      providers: [
        {
          kind: "saml",
          id: "acme",
          label: "Acme",
          entryPoint: "https://idp.example.com/sso",
          issuer: "https://app.example.com/metadata",
          certificateEnv: "TEST_SAML_CERT",
        },
      ],
    },
  },
});

function eventWithUrl(
  url: string | undefined,
  headers: Record<string, string> = {},
): FacilisHandlerEvent {
  return {
    context: {},
    req: { headers: new Headers(headers), ...(url === undefined ? {} : { url }) },
  };
}

describe("resolvePublicOrigin", () => {
  it("prefers FACILIS_PUBLIC_ORIGIN", () => {
    const origin = resolvePublicOrigin(eventWithUrl("http://localhost:5173/x"), {
      FACILIS_PUBLIC_ORIGIN: "https://app.example.com/",
    });
    expect(origin).toBe("https://app.example.com");
  });

  it("keeps a configured base path (IDE preview) and strips trailing slashes", () => {
    expect(
      resolvePublicOrigin(eventWithUrl("http://localhost:5173/x"), {
        FACILIS_PUBLIC_ORIGIN: "http://localhost:5173/preview/3000",
      }),
    ).toBe("http://localhost:5173/preview/3000");
    expect(
      resolvePublicOrigin(eventWithUrl("http://localhost:5173/x"), {
        FACILIS_PUBLIC_ORIGIN: "https://app.example.com/base/path///",
      }),
    ).toBe("https://app.example.com/base/path");
  });

  it("falls back to the request URL origin", () => {
    expect(resolvePublicOrigin(eventWithUrl("https://app.example.com/api/auth/sso"), {})).toBe(
      "https://app.example.com",
    );
  });

  it("falls back to Host + x-forwarded-proto when the URL is path-only", () => {
    expect(
      resolvePublicOrigin(
        eventWithUrl(undefined, { host: "app.example.com", "x-forwarded-proto": "https" }),
        {},
      ),
    ).toBe("https://app.example.com");
  });

  it("refuses a malformed or non-http origin instead of redirecting to it", () => {
    expect(() =>
      resolvePublicOrigin(eventWithUrl("http://localhost/x"), {
        FACILIS_PUBLIC_ORIGIN: "not a url",
      }),
    ).toThrow(/FACILIS_PUBLIC_ORIGIN/);
    expect(() =>
      resolvePublicOrigin(eventWithUrl("http://localhost/x"), {
        FACILIS_PUBLIC_ORIGIN: "ftp://app.example.com",
      }),
    ).toThrow(/http/);
    expect(() =>
      resolvePublicOrigin(eventWithUrl(undefined, { host: "app.example.com;evil" }), {}),
    ).toThrow(/origin/);
    expect(() =>
      resolvePublicOrigin(eventWithUrl("http://localhost/x"), {
        FACILIS_PUBLIC_ORIGIN: "https://app.example.com/?x=1",
      }),
    ).toThrow(/query/);
  });
});

describe("provider list and failure redirect", () => {
  it("lists configured providers from the environment", () => {
    expect(listSsoProviders(config, { TEST_SAML_CERT: "cert" })).toEqual([
      { id: "acme", label: "Acme", kind: "saml", startUrl: "/api/auth/sso/acme/start" },
    ]);
    expect(listSsoProviders(config, {})).toEqual([]);
  });

  it("appends sso_error while keeping the existing failure-redirect query", () => {
    expect(ssoFailureLocation(config, new SsoError("sso_state_invalid"))).toBe(
      "/login?from=sso&sso_error=sso_state_invalid",
    );
    expect(ssoFailureLocation(config, new Error("boom"))).toBe(
      "/login?from=sso&sso_error=sso_internal_error",
    );
  });

  it("declares every table the flow touches for the route's dbTables", () => {
    expect(SSO_ROUTE_TABLES).toEqual([
      "auth_sso_states",
      "auth_identities",
      "users",
      "user_roles",
      "sessions",
    ]);
  });
});
