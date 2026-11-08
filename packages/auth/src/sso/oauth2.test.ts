import { describe, expect, it, vi } from "vitest";

import type { FetchLike, FetchResponse } from "./contracts.ts";
import {
  buildOauth2AuthorizeUrl,
  exchangeOauth2Code,
  readDottedPath,
  readVerifiedClaim,
  resolveOauth2Identity,
  resolveOauth2IdentityFromCode,
} from "./oauth2.ts";
import type { Oauth2ProviderConfig } from "./providers.ts";

const provider: Oauth2ProviderConfig = {
  kind: "oauth2",
  id: "legacy",
  autoProvision: true,
  authorizationEndpoint: "https://idp.example.com/oauth/authorize",
  tokenEndpoint: "https://idp.example.com/oauth/token",
  userinfoEndpoint: "https://idp.example.com/oauth/userinfo",
  clientId: "client-1",
  clientSecretEnv: "LEGACY_SECRET",
  scopes: ["read:user"],
  tokenAuth: "client_secret_post",
  mapping: {
    subject: "data.user.id",
    email: "data.user.email",
    emailVerified: "data.user.verified",
  },
  assumeEmailVerified: false,
};

function jsonResponse(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function fakeFetch(
  handler: (
    url: string,
    init?: { headers?: Record<string, string>; body?: string },
  ) => FetchResponse,
): {
  fetch: FetchLike;
  calls: { url: string; headers?: Record<string, string>; body?: string }[];
} {
  const calls: { url: string; headers?: Record<string, string>; body?: string }[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({
        url,
        ...(init?.headers === undefined ? {} : { headers: init.headers }),
        ...(init?.body === undefined ? {} : { body: init.body }),
      });
      return handler(url, init);
    },
  };
}

const USERINFO = { data: { user: { id: "user-1", email: "user@example.com", verified: true } } };

describe("buildOauth2AuthorizeUrl", () => {
  it("sets the code flow parameters and the configured scopes", () => {
    const url = new URL(
      buildOauth2AuthorizeUrl(provider, "https://app.example/cb", "state-1", "challenge-1"),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("scope")).toBe("read:user");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("omits an empty scope parameter", () => {
    const url = new URL(
      buildOauth2AuthorizeUrl({ ...provider, scopes: [] }, "https://app.example/cb", "s", "c"),
    );
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("token exchange", () => {
  it("posts the code grant with client_secret_post", async () => {
    const fake = fakeFetch(() => jsonResponse({ access_token: "access-1", token_type: "bearer" }));
    const token = await exchangeOauth2Code(
      { clientId: "client-1", clientSecret: "secret-1", tokenAuth: "client_secret_post" },
      provider,
      {
        code: "code-1",
        redirectUri: "https://app.example/cb",
        codeVerifier: "verifier-1",
        fetch: fake.fetch,
      },
    );

    expect(token).toEqual({ accessToken: "access-1" });
    expect(fake.calls[0]?.url).toBe(provider.tokenEndpoint);
    expect(fake.calls[0]?.body).toContain("grant_type=authorization_code");
    expect(fake.calls[0]?.body).toContain("code=code-1");
    expect(fake.calls[0]?.body).toContain("client_secret=secret-1");
    expect(fake.calls[0]?.body).toContain("code_verifier=verifier-1");
  });

  it("uses HTTP Basic with client_secret_basic", async () => {
    const fake = fakeFetch(() => jsonResponse({ access_token: "access-1" }));
    await exchangeOauth2Code(
      { clientId: "client-1", clientSecret: "secret-1", tokenAuth: "client_secret_basic" },
      provider,
      {
        code: "code-1",
        redirectUri: "https://app.example/cb",
        codeVerifier: "verifier-1",
        fetch: fake.fetch,
      },
    );
    expect(fake.calls[0]?.headers?.["authorization"]).toBe("Basic " + btoa("client-1:secret-1"));
    expect(fake.calls[0]?.body).not.toContain("client_secret");
  });

  it("rejects a provider error without surfacing its body", async () => {
    const fake = fakeFetch(() =>
      jsonResponse({ error: "invalid_grant", error_description: "bad" }, 400),
    );
    await expect(
      exchangeOauth2Code(
        { clientId: "client-1", clientSecret: "secret-1", tokenAuth: "client_secret_post" },
        provider,
        {
          code: "code-1",
          redirectUri: "https://app.example/cb",
          codeVerifier: "verifier-1",
          fetch: fake.fetch,
        },
      ),
    ).rejects.toMatchObject({ code: "sso_exchange_failed" });
  });
});

describe("dotted-path mapping", () => {
  it("walks nested objects", () => {
    expect(readDottedPath(USERINFO, "data.user.email")).toBe("user@example.com");
    expect(readDottedPath(USERINFO, "data.missing.email")).toBeUndefined();
    expect(readDottedPath(null, "data")).toBeUndefined();
  });

  it('reads only boolean true and the string "true" as verified', () => {
    expect(readVerifiedClaim(true)).toBe(true);
    expect(readVerifiedClaim("true")).toBe(true);
    expect(readVerifiedClaim(false)).toBe(false);
    expect(readVerifiedClaim("yes")).toBeUndefined();
  });

  it("maps subject, email and the verified claim", () => {
    expect(resolveOauth2Identity(provider, USERINFO)).toEqual({
      subject: "user-1",
      email: "user@example.com",
      emailVerified: true,
    });
  });

  it("defaults an unreported emailVerified claim to the provider policy", () => {
    const withoutClaim: Oauth2ProviderConfig = {
      ...provider,
      mapping: { subject: "data.user.id", email: "data.user.email" },
    };
    expect(resolveOauth2Identity(withoutClaim, USERINFO).emailVerified).toBe(false);
    expect(
      resolveOauth2Identity({ ...withoutClaim, assumeEmailVerified: true }, USERINFO).emailVerified,
    ).toBe(true);
  });

  it("accepts a numeric subject id", () => {
    const identity = resolveOauth2Identity(provider, {
      data: { user: { id: 42, email: "numeric@example.com", verified: true } },
    });
    expect(identity.subject).toBe("42");
  });

  it("rejects a missing subject or email mapping", () => {
    expect(() => resolveOauth2Identity(provider, { data: { user: { email: "a@b.c" } } })).toThrow(
      /no subject mapping/,
    );
    expect(() => resolveOauth2Identity(provider, { data: { user: { id: "u" } } })).toThrow(
      /no email mapping/,
    );
  });
});

describe("runtime fetch fallback", () => {
  it("uses globalThis.fetch when no fetch is injected", async () => {
    const fake = fakeFetch((url) =>
      url === provider.tokenEndpoint
        ? jsonResponse({ access_token: "access-1" })
        : jsonResponse(USERINFO),
    );
    vi.stubGlobal("fetch", fake.fetch);
    try {
      const identity = await resolveOauth2IdentityFromCode(
        { clientId: "client-1", clientSecret: "secret-1", tokenAuth: "client_secret_post" },
        provider,
        { code: "code-1", redirectUri: "https://app.example/cb", codeVerifier: "verifier-1" },
      );
      expect(identity.subject).toBe("user-1");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("resolveOauth2IdentityFromCode", () => {
  it("exchanges the code then reads the userinfo with a Bearer token", async () => {
    const fake = fakeFetch((url) =>
      url === provider.tokenEndpoint
        ? jsonResponse({ access_token: "access-1" })
        : jsonResponse(USERINFO),
    );

    const identity = await resolveOauth2IdentityFromCode(
      { clientId: "client-1", clientSecret: "secret-1", tokenAuth: "client_secret_post" },
      provider,
      {
        code: "code-1",
        redirectUri: "https://app.example/cb",
        codeVerifier: "verifier-1",
        fetch: fake.fetch,
      },
    );

    expect(identity).toEqual({ subject: "user-1", email: "user@example.com", emailVerified: true });
    expect(fake.calls[1]?.url).toBe(provider.userinfoEndpoint);
    expect(fake.calls[1]?.headers?.["authorization"]).toBe("Bearer access-1");
  });

  it("maps a userinfo failure to sso_exchange_failed", async () => {
    const fake = fakeFetch((url) =>
      url === provider.tokenEndpoint
        ? jsonResponse({ access_token: "access-1" })
        : jsonResponse({ error: "nope" }, 401),
    );
    await expect(
      resolveOauth2IdentityFromCode(
        { clientId: "client-1", clientSecret: "secret-1", tokenAuth: "client_secret_post" },
        provider,
        {
          code: "code-1",
          redirectUri: "https://app.example/cb",
          codeVerifier: "verifier-1",
          fetch: fake.fetch,
        },
      ),
    ).rejects.toMatchObject({ code: "sso_exchange_failed" });
  });
});
