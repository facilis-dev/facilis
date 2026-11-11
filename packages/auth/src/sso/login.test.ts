import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb } from "@facilis/db";

import type { FetchResponse, SsoAudit, SsoAuditInput, SystemRunner } from "./contracts.ts";
import { completeLogin, startLogin, type SsoFlowDeps } from "./login.ts";
import { ssoCallbackUrl } from "./paths.ts";
import type { OidcDeps } from "./oidc.ts";
import type { OidcProviderConfig, SamlProviderConfig, SsoConfigLike } from "./providers.ts";
import { authSsoStates } from "./tables.ts";
import { roles, users } from "../tables.ts";
import { createAuthTestDb } from "../test-support.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ISSUER = "https://idp.example.com";
const CLIENT_ID = "client-1";
const PUBLIC_ORIGIN = "https://app.example.com";

const OIDC: OidcProviderConfig = {
  kind: "oidc",
  id: "corp",
  autoProvision: true,
  issuer: ISSUER,
  clientId: CLIENT_ID,
  clientSecretEnv: "CORP_OIDC_SECRET",
  scopes: ["openid", "email"],
  tokenAuth: "client_secret_post",
  assumeEmailVerified: false,
};

const SAML: SamlProviderConfig = {
  kind: "saml",
  id: "acme",
  autoProvision: true,
  entryPoint: "https://idp.example.com/saml/sso",
  issuer: "https://app.example.com/saml/metadata",
  certificateEnv: "ACME_SAML_CERT",
  emailAttribute: "email",
  wantAssertionsSigned: true,
  wantResponseSigned: false,
};

let db: FacilisDb;
let system: SystemRunner;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwks: ReturnType<typeof createLocalJWKSet>;
let fetchHandler: (url: string) => FetchResponse;
let auditEntries: SsoAuditInput[];
let warnings: { message: string; data?: Record<string, unknown> }[];

const audit: SsoAudit = (input) => {
  auditEntries.push(input);
};

function response(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: "https://idp.example.com/authorize",
  token_endpoint: "https://idp.example.com/token",
  jwks_uri: "https://idp.example.com/jwks",
};

function ssoConfig(providers: SsoConfigLike["providers"]): SsoConfigLike {
  return { providers, failureRedirect: "/login", stateTtlMs: 600_000 };
}

function deps(overrides: Partial<SsoFlowDeps> = {}): SsoFlowDeps {
  const oidc: OidcDeps = { fetch: async (url) => fetchHandler(url), jwksResolver: () => jwks };
  return {
    sso: ssoConfig([OIDC, SAML]),
    defaultRole: "user",
    verificationEnabled: false,
    publicOrigin: PUBLIC_ORIGIN,
    system,
    audit,
    environment: { CORP_OIDC_SECRET: "secret-1", ACME_SAML_CERT: "cert-1" },
    fetch: async (url) => fetchHandler(url),
    oidc,
    warn: (message, data) => {
      warnings.push({ message, data });
    },
    ...overrides,
  };
}

async function readState(state: string) {
  const rows = await db.db.select().from(authSsoStates).where(eq(authSsoStates.state, state));
  return rows[0] ?? null;
}

async function signIdToken(nonce: string, claims: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    sub: "subject-1",
    email: "sso@example.com",
    email_verified: true,
    nonce,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "key-1" })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

beforeAll(async () => {
  db = await createAuthTestDb();
  system = (_options, fn) => runWithPolicyScope(db, { tenantId: TENANT_ID }, fn);
  await db.db.insert(roles).values([{ name: "user" }, { name: "admin" }]);
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "RS256", use: "sig" };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

afterAll(async () => {
  await db.close();
});

describe("OIDC login flow", () => {
  it("starts with discovery, PKCE and nonce stored in a single-use state", async () => {
    auditEntries = [];
    fetchHandler = (url) => {
      if (url === `${ISSUER}/.well-known/openid-configuration`) return response(DISCOVERY);
      throw new Error("unexpected fetch " + url);
    };

    const started = await startLogin(deps(), { providerId: "corp", redirectTo: "/todos" });
    const url = new URL(started.redirectUrl);
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint);
    expect(url.searchParams.get("redirect_uri")).toBe(ssoCallbackUrl(PUBLIC_ORIGIN, "corp"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).not.toBeNull();

    const state = await readState(url.searchParams.get("state") ?? "");
    expect(state?.provider).toBe("corp");
    expect(state?.redirectTo).toBe("/todos");
    expect(state?.nonce).not.toBeNull();
    expect(state?.codeVerifier).not.toBeNull();
    expect(auditEntries).toContainEqual(
      expect.objectContaining({
        operation: "auth:sso:start",
        outcome: "succeeded",
        details: { provider: "corp" },
      }),
    );
  });

  it("completes the code exchange, provisions the user and consumes the state", async () => {
    auditEntries = [];
    fetchHandler = (url) => {
      if (url === `${ISSUER}/.well-known/openid-configuration`) return response(DISCOVERY);
      throw new Error("unexpected fetch " + url);
    };
    const started = await startLogin(deps(), { providerId: "corp", redirectTo: "/todos" });
    const authorizeUrl = new URL(started.redirectUrl);
    const stateValue = authorizeUrl.searchParams.get("state") ?? "";
    const state = await readState(stateValue);
    if (state?.nonce === null || state?.nonce === undefined) throw new Error("missing nonce");

    const idToken = await signIdToken(state.nonce);
    fetchHandler = (url) => {
      if (url === DISCOVERY.token_endpoint)
        return response({ access_token: "access-1", id_token: idToken });
      throw new Error("unexpected fetch " + url);
    };

    const result = await completeLogin(deps(), "corp", {
      method: "GET",
      code: "code-1",
      state: stateValue,
    });
    expect(result.redirectTo).toBe("/todos");
    expect(result.resolution.outcome).toBe("provisioned");

    const [user] = await db.db
      .select({ email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, result.userId));
    expect(user).toEqual({ email: "sso@example.com", passwordHash: null });
    expect(auditEntries).toContainEqual(
      expect.objectContaining({
        operation: "auth:sso:login",
        outcome: "succeeded",
        details: { provider: "corp" },
      }),
    );

    // Single use: replaying the same callback is a state failure.
    await expect(
      completeLogin(deps(), "corp", { method: "GET", code: "code-1", state: stateValue }),
    ).rejects.toMatchObject({ code: "sso_state_invalid" });
  });

  it("refuses a provider whose secret environment variable is missing, without logging it", async () => {
    auditEntries = [];
    warnings = [];
    await expect(
      startLogin(deps({ environment: {} }), { providerId: "corp", redirectTo: null }),
    ).rejects.toMatchObject({ code: "sso_provider_unavailable" });
    expect(warnings).toEqual([
      {
        message: "sso provider is not configured",
        data: { provider: "corp", env: "CORP_OIDC_SECRET" },
      },
    ]);
    expect(JSON.stringify(auditEntries)).not.toContain("secret");
  });

  it("refuses an unknown user when autoProvision is off", async () => {
    fetchHandler = (url) => {
      if (url === `${ISSUER}/.well-known/openid-configuration`) return response(DISCOVERY);
      throw new Error("unexpected fetch " + url);
    };
    const strict: OidcProviderConfig = { ...OIDC, id: "strict", autoProvision: false };
    const localDeps = deps({ sso: ssoConfig([strict]) });
    const started = await startLogin(localDeps, { providerId: "strict", redirectTo: null });
    const stateValue = new URL(started.redirectUrl).searchParams.get("state") ?? "";
    const state = await readState(stateValue);
    if (state?.nonce === null || state?.nonce === undefined) throw new Error("missing nonce");

    const idToken = await signIdToken(state.nonce, { email: "unknown@example.com" });
    fetchHandler = (url) => {
      if (url === DISCOVERY.token_endpoint)
        return response({ access_token: "access-1", id_token: idToken });
      throw new Error("unexpected fetch " + url);
    };
    await expect(
      completeLogin(localDeps, "strict", { method: "GET", code: "code-1", state: stateValue }),
    ).rejects.toMatchObject({ code: "sso_account_not_found" });
  });
});

describe("SAML login flow", () => {
  it("starts with a RelayState-bound AuthnRequest and completes through the validator", async () => {
    auditEntries = [];
    const started = await startLogin(deps(), { providerId: "acme", redirectTo: "/todos" });
    const url = new URL(started.redirectUrl);
    expect(url.origin + url.pathname).toBe(SAML.entryPoint);
    const relayState = url.searchParams.get("RelayState") ?? "";
    const state = await readState(relayState);
    expect(state?.provider).toBe("acme");
    expect(state?.requestId).toMatch(/^_[0-9a-f-]{36}$/);

    const samlDeps = deps({
      samlValidatorFactory: () => ({
        validatePostResponseAsync: async () => ({
          profile: { nameID: "saml-subject", email: "saml@example.com" },
          loggedOut: false,
        }),
      }),
    });
    const result = await completeLogin(samlDeps, "acme", {
      method: "POST",
      samlResponse: "ZmFrZQ==",
      relayState,
    });
    expect(result.redirectTo).toBe("/todos");
    expect(result.resolution.outcome).toBe("provisioned");

    await expect(
      completeLogin(samlDeps, "acme", { method: "POST", samlResponse: "ZmFrZQ==", relayState }),
    ).rejects.toMatchObject({ code: "sso_state_invalid" });
  });

  it("rejects a callback whose protocol does not match the provider kind", async () => {
    fetchHandler = () => {
      throw new Error("no fetch expected");
    };
    await expect(
      completeLogin(deps(), "corp", { method: "POST", samlResponse: "x", relayState: "y" }),
    ).rejects.toMatchObject({ code: "sso_state_invalid" });
    await expect(
      completeLogin(deps(), "acme", { method: "GET", code: "x", state: "y" }),
    ).rejects.toMatchObject({ code: "sso_state_invalid" });
  });
});
