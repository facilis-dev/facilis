import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FacilisConfig, FacilisRequestEvent } from "@facilis/core";
import { DEFAULT_LOGGING_CONFIG, defineConfig, NOOP_LOGGING_API } from "@facilis/core";
import { createDb, ensureAppRole, type FacilisDb } from "@facilis/db";

vi.mock("../runtime/bootstrap.ts", () => ({ getBootstrap: vi.fn() }));
vi.mock("../runtime/sso.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime/sso.ts")>();
  return {
    ...actual,
    startSsoLogin: vi.fn(),
    completeSsoLogin: vi.fn(),
  };
});
vi.mock("@facilis/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis/auth")>();
  return {
    ...actual,
    createSession: vi.fn(async () => ({
      id: "session-1",
      expiresAt: new Date(Date.now() + 60_000),
    })),
  };
});

import { SsoError } from "@facilis/auth";
import { getBootstrap, type BootstrapState } from "../runtime/bootstrap.ts";
import { startSsoLogin, completeSsoLogin } from "../runtime/sso.ts";
import handler from "./sso.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const config: FacilisConfig = defineConfig({
  auth: {
    defaultRole: "user",
    roles: { user: [] },
    sso: {
      failureRedirect: "/login",
      providers: [
        {
          kind: "saml",
          id: "acme",
          label: "Acme",
          entryPoint: "https://idp.example.com/sso",
          issuer: "https://app.example.com/metadata",
          certificateEnv: "TEST_SAML_CERT",
        },
        {
          kind: "oidc",
          id: "corp",
          issuer: "https://idp.example.com",
          clientId: "client-1",
          clientSecretEnv: "MISSING_OIDC_SECRET",
        },
      ],
    },
  },
});

let db: FacilisDb;

function state(): BootstrapState {
  return {
    db,
    config,
    warnings: [],
    startedAt: "2026-11-08T00:00:00.000Z",
    jobs: null,
    tasks: null,
    workflows: null,
    storage: null,
    logging: NOOP_LOGGING_API,
    loggingConfig: DEFAULT_LOGGING_CONFIG,
  };
}

function makeEvent(
  path: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): { event: FacilisRequestEvent; resHeaders: Headers } {
  const resHeaders = new Headers();
  const request = new Request("http://localhost" + path, {
    method: options.method ?? "GET",
    headers: options.headers,
    ...(options.body === undefined ? {} : { body: options.body }),
  });
  const event: FacilisRequestEvent = {
    context: { facilis: { db, defaultTenantId: TENANT_ID } },
    req: request,
    res: { headers: resHeaders },
  };
  return { event, resHeaders };
}

function location(response: Response): string {
  return response.headers.get("location") ?? "";
}

beforeAll(async () => {
  process.env.TEST_SAML_CERT = "cert";
  delete process.env.MISSING_OIDC_SECRET;
  db = await createDb();
  await ensureAppRole(db);
});

afterAll(async () => {
  delete process.env.TEST_SAML_CERT;
  await db.close();
});

beforeEach(() => {
  vi.mocked(getBootstrap).mockResolvedValue(state());
  vi.mocked(startSsoLogin).mockReset();
  vi.mocked(completeSsoLogin).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SSO route dispatch", () => {
  it("lists configured providers with no-store and hides the unconfigured one", async () => {
    const { event } = makeEvent("/api/auth/sso/providers");
    const response = (await handler(event)) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = (await response.json()) as { providers: unknown };
    expect(payload.providers).toEqual([
      { id: "acme", label: "Acme", kind: "saml", startUrl: "/api/auth/sso/acme/start" },
    ]);
    expect(JSON.stringify(payload)).not.toContain("cert");
  });

  it("answers 404 for an unknown path, a wrong method and a malformed percent-encoding", async () => {
    const cases = [
      ["/api/auth/sso/acme", "GET"],
      ["/api/auth/sso/providers", "POST"],
      ["/api/auth/sso/acme/start", "POST"],
      ["/api/auth/sso/acme/callback", "PATCH"],
      ["/api/auth/sso/%E0%A4%A/start", "GET"],
    ] as const;
    const results = await Promise.all(
      cases.map(async ([path, method]) => {
        const { event } = makeEvent(path, { method });
        const response = (await handler(event)) as Response;
        return { path, status: response.status, body: await response.json() };
      }),
    );
    for (const { path, status, body } of results) {
      expect(status, path).toBe(404);
      expect(body).toEqual({ code: "not_found" });
    }
  });

  it("redirects a start to the IdP and passes the post-login redirect through", async () => {
    vi.mocked(startSsoLogin).mockResolvedValue({
      redirectUrl: "https://idp.example.com/auth?state=1",
    });
    const { event } = makeEvent("/api/auth/sso/acme/start?redirect=%2Ftodos");
    const response = (await handler(event)) as Response;

    expect(response.status).toBe(302);
    expect(location(response)).toBe("https://idp.example.com/auth?state=1");
    expect(startSsoLogin).toHaveBeenCalledWith(expect.anything(), "acme", "/todos");
  });

  it("redirects a start failure to failureRedirect with a safe code", async () => {
    vi.mocked(startSsoLogin).mockRejectedValue(new SsoError("sso_provider_unavailable"));
    const { event } = makeEvent("/api/auth/sso/corp/start");
    const response = (await handler(event)) as Response;

    expect(response.status).toBe(302);
    expect(location(response)).toBe("/login?sso_error=sso_provider_unavailable");
  });

  it("completes a code callback, starts a session and sets the cookie", async () => {
    vi.mocked(completeSsoLogin).mockResolvedValue({
      userId: "user-1",
      redirectTo: "/todos",
      resolution: { userId: "user-1", outcome: "existing" },
    });
    const { event, resHeaders } = makeEvent(
      "/api/auth/sso/corp/callback?code=code-1&state=state-1",
    );
    const response = (await handler(event)) as Response;

    expect(response.status).toBe(302);
    expect(location(response)).toBe("/todos");
    expect(completeSsoLogin).toHaveBeenCalledWith(expect.anything(), "corp", {
      method: "GET",
      code: "code-1",
      state: "state-1",
    });
    expect(resHeaders.getSetCookie()[0]).toContain("facilis_session=session-1");
  });

  it("redirects a callback failure without leaking the internal message", async () => {
    vi.mocked(completeSsoLogin).mockRejectedValue(
      new SsoError("sso_exchange_failed", "secret detail"),
    );
    const { event } = makeEvent("/api/auth/sso/corp/callback?code=code-1&state=state-1");
    const response = (await handler(event)) as Response;

    expect(location(response)).toBe("/login?sso_error=sso_exchange_failed");
    expect(JSON.stringify([...response.headers.entries()])).not.toContain("secret detail");
  });

  it("rejects a callback with a missing state before exchanging the code", async () => {
    const { event } = makeEvent("/api/auth/sso/corp/callback?code=code-1");
    const response = (await handler(event)) as Response;
    expect(location(response)).toBe("/login?sso_error=sso_state_invalid");
    expect(completeSsoLogin).not.toHaveBeenCalled();
  });

  it("validates the two SAML form fields and completes the ACS POST", async () => {
    vi.mocked(completeSsoLogin).mockResolvedValue({
      userId: "user-1",
      redirectTo: "/todos",
      resolution: { userId: "user-1", outcome: "linked" },
    });
    const body = "SAMLResponse=ZmFrZQ%3D%3D&RelayState=state-1";
    const { event, resHeaders } = makeEvent("/api/auth/sso/acme/callback", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const response = (await handler(event)) as Response;

    expect(response.status).toBe(302);
    expect(location(response)).toBe("/todos");
    expect(completeSsoLogin).toHaveBeenCalledWith(expect.anything(), "acme", {
      method: "POST",
      samlResponse: "ZmFrZQ==",
      relayState: "state-1",
    });
    expect(resHeaders.getSetCookie()[0]).toContain("facilis_session=session-1");
  });

  it("redirects a malformed SAML POST instead of parsing it", async () => {
    const bodies = ["", "RelayState=state-1", "SAMLResponse=x"];
    const responses = await Promise.all(
      bodies.map(async (body) => {
        const { event } = makeEvent("/api/auth/sso/acme/callback", {
          method: "POST",
          body,
          headers: { "content-type": "application/x-www-form-urlencoded" },
        });
        return (await handler(event)) as Response;
      }),
    );
    for (const response of responses) {
      expect(location(response)).toBe("/login?sso_error=sso_exchange_failed");
    }
    expect(completeSsoLogin).not.toHaveBeenCalled();
  });

  it("rejects an oversized ACS body from its content-length before buffering it", async () => {
    const { event } = makeEvent("/api/auth/sso/acme/callback", {
      method: "POST",
      body: "SAMLResponse=x&RelayState=state-1",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(2 * 1024 * 1024),
      },
    });
    const response = (await handler(event)) as Response;
    expect(location(response)).toBe("/login?sso_error=sso_exchange_failed");
    expect(completeSsoLogin).not.toHaveBeenCalled();
  });
});
