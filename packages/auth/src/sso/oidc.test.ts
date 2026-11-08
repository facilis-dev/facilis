import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { encodeBase64, webcrypto } from "../crypto.ts";
import type { FetchLike, FetchResponse } from "./contracts.ts";
import {
  buildOidcAuthorizeUrl,
  clearOidcDiscoveryCache,
  discoverOidc,
  resolveOidcIdentity,
  verifyOidcIdToken,
  type OidcDiscovery,
} from "./oidc.ts";
import { createPkcePair } from "./pkce.ts";
import type { TokenPayload } from "./oauth2.ts";
import type { OidcProviderConfig } from "./providers.ts";

const ISSUER = "https://idp.example.com";
const CLIENT_ID = "client-1";
const NONCE = "nonce-1";

const provider: OidcProviderConfig = {
  kind: "oidc",
  id: "corp",
  autoProvision: true,
  issuer: ISSUER,
  clientId: CLIENT_ID,
  clientSecretEnv: "SECRET",
  scopes: ["openid", "email", "profile"],
  tokenAuth: "client_secret_post",
  assumeEmailVerified: false,
};

const discovery: OidcDiscovery = {
  issuer: ISSUER,
  authorizationEndpoint: "https://idp.example.com/authorize",
  tokenEndpoint: "https://idp.example.com/token",
  userinfoEndpoint: "https://idp.example.com/userinfo",
  jwksUri: "https://idp.example.com/jwks",
};

/** The wire document (snake_case) the discovery endpoint returns. */
const DISCOVERY_DOC = {
  issuer: ISSUER,
  authorization_endpoint: discovery.authorizationEndpoint,
  token_endpoint: discovery.tokenEndpoint,
  userinfo_endpoint: discovery.userinfoEndpoint,
  jwks_uri: discovery.jwksUri,
};

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let publicKey: KeyPair["publicKey"];
let privateKey: KeyPair["privateKey"];
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  publicKey = pair.publicKey;
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "key-1", alg: "RS256", use: "sig" };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

afterAll(() => {
  clearOidcDiscoveryCache();
});

async function signToken(
  claims: Record<string, unknown> = {},
  options: { audience?: string; expiresIn?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    sub: "subject-1",
    nonce: NONCE,
    email: "user@example.com",
    email_verified: true,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "key-1" })
    .setIssuer(ISSUER)
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresIn ?? 300))
    .sign(privateKey);
}

function jsonResponse(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function fakeFetch(handler: (url: string) => FetchResponse | Promise<FetchResponse>): {
  fetch: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      return handler(url);
    },
  };
}

describe("PKCE and authorize URL", () => {
  it("builds a 43-character verifier whose challenge is base64url(SHA-256(verifier))", async () => {
    const pair = await createPkcePair();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const digest = await webcrypto().subtle.digest(
      "SHA-256",
      new TextEncoder().encode(pair.verifier),
    );
    const expected = encodeBase64(new Uint8Array(digest))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    expect(pair.challenge).toBe(expected);
  });

  it("sets response_type, scope, state, nonce and PKCE S256 on the authorization URL", async () => {
    const url = new URL(
      buildOidcAuthorizeUrl(provider, discovery, {
        redirectUri: "https://app.example.com/api/auth/sso/corp/callback",
        state: "state-1",
        nonce: NONCE,
        codeChallenge: "challenge-1",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://idp.example.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("nonce")).toBe(NONCE);
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/auth/sso/corp/callback",
    );
  });
});

describe("OpenID discovery", () => {
  it("fetches the well-known document once and caches it per provider", async () => {
    clearOidcDiscoveryCache();
    const fake = fakeFetch(() => jsonResponse(DISCOVERY_DOC));
    const first = await discoverOidc(provider, { fetch: fake.fetch, now: () => 1_000 });
    const second = await discoverOidc(provider, { fetch: fake.fetch, now: () => 2_000 });

    expect(first).toEqual(discovery);
    expect(second).toBe(first);
    expect(fake.calls).toEqual([`${ISSUER}/.well-known/openid-configuration`]);
  });

  it("uses globalThis.fetch when no fetch is injected", async () => {
    clearOidcDiscoveryCache();
    vi.stubGlobal("fetch", async () => jsonResponse(DISCOVERY_DOC));
    try {
      const found = await discoverOidc(provider);
      expect(found.jwksUri).toBe(discovery.jwksUri);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refetches after the TTL and rejects a malformed document", async () => {
    clearOidcDiscoveryCache();
    let calls = 0;
    const fake = fakeFetch(() => {
      calls += 1;
      return calls === 1 ? jsonResponse(DISCOVERY_DOC) : jsonResponse({ issuer: ISSUER });
    });
    await discoverOidc(provider, { fetch: fake.fetch, now: () => 0 });
    await expect(
      discoverOidc(provider, { fetch: fake.fetch, now: () => 10_000, discoveryTtlMs: 1_000 }),
    ).rejects.toMatchObject({ code: "sso_provider_unavailable" });
  });
});

describe("ID token verification", () => {
  it("accepts a valid token and extracts the claims", async () => {
    const token = await signToken();
    const claims = await verifyOidcIdToken(provider, discovery, token, NONCE, {
      jwksResolver: () => jwks,
    });
    expect(claims).toEqual({
      subject: "subject-1",
      email: "user@example.com",
      emailVerified: true,
    });
  });

  it("rejects a wrong nonce", async () => {
    const token = await signToken({ nonce: "other" });
    await expect(
      verifyOidcIdToken(provider, discovery, token, NONCE, { jwksResolver: () => jwks }),
    ).rejects.toMatchObject({ code: "sso_identity_invalid" });
  });

  it("rejects a wrong audience", async () => {
    const token = await signToken({}, { audience: "someone-else" });
    await expect(
      verifyOidcIdToken(provider, discovery, token, NONCE, { jwksResolver: () => jwks }),
    ).rejects.toMatchObject({ code: "sso_identity_invalid" });
  });

  it("rejects an expired token", async () => {
    const token = await signToken({}, { expiresIn: -10 });
    await expect(
      verifyOidcIdToken(provider, discovery, token, NONCE, { jwksResolver: () => jwks }),
    ).rejects.toMatchObject({ code: "sso_identity_invalid" });
  });

  it("honours assumeEmailVerified when the claim is absent", async () => {
    const token = await signToken({ email_verified: undefined });
    const claims = await verifyOidcIdToken(provider, discovery, token, NONCE, {
      jwksResolver: () => jwks,
    });
    expect(claims.emailVerified).toBe(false);

    const trusting = { ...provider, assumeEmailVerified: true };
    const trusted = await verifyOidcIdToken(trusting, discovery, token, NONCE, {
      jwksResolver: () => jwks,
    });
    expect(trusted.emailVerified).toBe(true);
  });
});

describe("userinfo fallback", () => {
  const token: TokenPayload = { accessToken: "access-1" };

  it("fills a missing email from the userinfo endpoint", async () => {
    const idToken = await signToken({ email: undefined });
    const fake = fakeFetch((url) => {
      expect(url).toBe(discovery.userinfoEndpoint);
      return jsonResponse({
        sub: "subject-1",
        email: "fallback@example.com",
        email_verified: true,
      });
    });

    const claims = await resolveOidcIdentity(provider, discovery, { ...token, idToken }, NONCE, {
      jwksResolver: () => jwks,
      fetch: fake.fetch,
    });
    expect(claims).toEqual({
      provider: "corp",
      subject: "subject-1",
      email: "fallback@example.com",
      emailVerified: true,
    });
  });

  it("rejects a userinfo subject that disagrees with the verified ID token", async () => {
    const idToken = await signToken({ email: undefined });
    const fake = fakeFetch(() => jsonResponse({ sub: "someone-else", email: "x@example.com" }));

    await expect(
      resolveOidcIdentity(provider, discovery, { ...token, idToken }, NONCE, {
        jwksResolver: () => jwks,
        fetch: fake.fetch,
      }),
    ).rejects.toMatchObject({ code: "sso_identity_invalid" });
  });

  it("rejects an identity without any email", async () => {
    const idToken = await signToken({ email: undefined });
    const fake = fakeFetch(() => jsonResponse({ sub: "subject-1" }));
    await expect(
      resolveOidcIdentity(provider, discovery, { ...token, idToken }, NONCE, {
        jwksResolver: () => jwks,
        fetch: fake.fetch,
      }),
    ).rejects.toMatchObject({ code: "sso_identity_invalid" });
  });
});
