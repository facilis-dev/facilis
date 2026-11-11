import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb } from "@facilis.dev/db";

import type { FetchLike, FetchResponse, SsoAudit, SystemRunner } from "./contracts.ts";
import { completeLogin, startLogin, type SsoFlowDeps } from "./login.ts";
import type { Oauth2ProviderConfig } from "./providers.ts";
import { createSsoState } from "./state.ts";
import { authSsoStates } from "./tables.ts";
import { roles, users } from "../tables.ts";
import { createAuthTestDb } from "../test-support.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PUBLIC_ORIGIN = "https://app.example.com";

const PROVIDER: Oauth2ProviderConfig = {
  kind: "oauth2",
  id: "legacy",
  label: "Legacy",
  autoProvision: true,
  authorizationEndpoint: "https://idp.example.com/oauth/authorize",
  tokenEndpoint: "https://idp.example.com/oauth/token",
  userinfoEndpoint: "https://idp.example.com/oauth/userinfo",
  clientId: "client-1",
  clientSecretEnv: "LEGACY_SECRET",
  scopes: ["read:user"],
  tokenAuth: "client_secret_post",
  mapping: { subject: "id", email: "email" },
  assumeEmailVerified: true,
};

const USERINFO = { id: "user-1", email: "oauth2@example.com" };

let db: FacilisDb;
let system: SystemRunner;
let calls: { url: string; body?: string; headers?: Record<string, string> }[];
let status = 200;

const audit: SsoAudit = () => {
  // Audit is exercised by the identity/login suites; here it only must not throw.
};

function response(body: unknown, responseStatus = 200): FetchResponse {
  return {
    ok: responseStatus >= 200 && responseStatus < 300,
    status: responseStatus,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const fetch: FetchLike = async (url, init) => {
  calls.push({
    url,
    ...(init?.body === undefined ? {} : { body: init.body }),
    ...(init?.headers === undefined ? {} : { headers: init.headers }),
  });
  if (status !== 200) return response({ error: "invalid_grant" }, status);
  if (url === PROVIDER.tokenEndpoint) return response({ access_token: "access-1" });
  if (url === PROVIDER.userinfoEndpoint) return response(USERINFO);
  throw new Error("unexpected fetch " + url);
};

function deps(overrides: Partial<SsoFlowDeps> = {}): SsoFlowDeps {
  return {
    sso: { providers: [PROVIDER], failureRedirect: "/login", stateTtlMs: 600_000 },
    defaultRole: "user",
    verificationEnabled: false,
    publicOrigin: PUBLIC_ORIGIN,
    system,
    audit,
    environment: { LEGACY_SECRET: "secret-1" },
    fetch,
    ...overrides,
  };
}

async function stateRow(state: string) {
  const rows = await db.db.select().from(authSsoStates).where(eq(authSsoStates.state, state));
  return rows[0] ?? null;
}

beforeAll(async () => {
  db = await createAuthTestDb();
  system = (_options, fn) => runWithPolicyScope(db, { tenantId: TENANT_ID }, fn);
  await db.db.insert(roles).values([{ name: "user" }]);
});

afterAll(async () => {
  await db.close();
});

describe("generic OAuth2 login", () => {
  it("starts with a PKCE S256 challenge and stores the verifier in the state", async () => {
    calls = [];
    const started = await startLogin(deps(), { providerId: "legacy", redirectTo: "/todos" });
    const url = new URL(started.redirectUrl);

    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const state = await stateRow(url.searchParams.get("state") ?? "");
    expect(state?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("sends code_verifier on the token exchange and resolves the mapped identity", async () => {
    calls = [];
    status = 200;
    const started = await startLogin(deps(), { providerId: "legacy", redirectTo: "/todos" });
    const stateValue = new URL(started.redirectUrl).searchParams.get("state") ?? "";
    const state = await stateRow(stateValue);

    const result = await completeLogin(deps(), "legacy", {
      method: "GET",
      code: "code-1",
      state: stateValue,
    });

    expect(result.redirectTo).toBe("/todos");
    expect(result.resolution.outcome).toBe("provisioned");
    expect(calls[0]?.url).toBe(PROVIDER.tokenEndpoint);
    // The verifier is the one from the consumed state row, not a fresh value.
    expect(new URLSearchParams(calls[0]?.body ?? "").get("code_verifier")).toBe(
      state?.codeVerifier,
    );
    const [user] = await db.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, result.userId));
    expect(user?.email).toBe("oauth2@example.com");
  });

  it("rejects a state row without a PKCE verifier before exchanging the code", async () => {
    calls = [];
    await createSsoState(system, {
      state: "state-without-verifier-000000",
      provider: "legacy",
      ttlMs: 60_000,
      redirectTo: null,
    });

    await expect(
      completeLogin(deps(), "legacy", {
        method: "GET",
        code: "code-1",
        state: "state-without-verifier-000000",
      }),
    ).rejects.toMatchObject({ code: "sso_state_invalid" });
    expect(calls).toEqual([]);
  });

  it("maps a rejected token exchange to sso_exchange_failed", async () => {
    calls = [];
    status = 400;
    const started = await startLogin(deps(), { providerId: "legacy", redirectTo: null });
    const stateValue = new URL(started.redirectUrl).searchParams.get("state") ?? "";
    try {
      await expect(
        completeLogin(deps(), "legacy", { method: "GET", code: "code-1", state: stateValue }),
      ).rejects.toMatchObject({ code: "sso_exchange_failed" });
    } finally {
      status = 200;
    }
  });
});
