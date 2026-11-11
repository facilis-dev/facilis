import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FacilisAuditInput,
  FacilisConfig,
  FacilisLoggingApi,
  FacilisRequestEvent,
} from "@facilis/core";
import { DEFAULT_LOGGING_CONFIG, defineConfig } from "@facilis/core";
import { createDb, ensureAppRole, type FacilisDb } from "@facilis/db";

vi.mock("../runtime/bootstrap.ts", () => ({ getBootstrap: vi.fn() }));
// Only the exchange is mocked: the route's dispatch, validation and audit are the subject.
vi.mock("@facilis/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis/auth")>();
  return { ...actual, issueApiToken: vi.fn() };
});

import { issueApiToken } from "@facilis/auth";
import { getBootstrap, type BootstrapState } from "../runtime/bootstrap.ts";
import handler from "./token.post.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TTL_MS = 3_600_000;
const VALID_BODY = {
  grant_type: "client_credentials",
  client_id: "client-1",
  client_secret: "secret-1",
};

/** Audit entries the route emitted through the request logger bound in the wrapper. */
const audits: FacilisAuditInput[] = [];

const loggingApi: FacilisLoggingApi = {
  record: () => {},
  logger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    audit: (event) => {
      audits.push(event);
    },
  }),
};

let db: FacilisDb;

function config(
  input: {
    enabled?: boolean;
    tokenTtlMs?: number;
    rateLimit?: { windowMs: number; maxRequests: number };
  } = {},
): FacilisConfig {
  return defineConfig({
    auth: {
      defaultRole: "user",
      roles: { user: [] },
      apiClients: {
        enabled: input.enabled ?? true,
        tokenTtlMs: input.tokenTtlMs ?? TTL_MS,
        ...(input.rateLimit === undefined ? {} : { rateLimit: input.rateLimit }),
      },
    },
  });
}

function state(projectConfig: FacilisConfig | null): BootstrapState {
  return {
    db,
    config: projectConfig,
    warnings: [],
    startedAt: "2026-11-10T00:00:00.000Z",
    jobs: null,
    storage: null,
    logging: loggingApi,
    loggingConfig: DEFAULT_LOGGING_CONFIG,
  };
}

function makeEvent(body: unknown): FacilisRequestEvent {
  const request = new Request("http://localhost/api/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    context: {
      facilis: { db, defaultTenantId: TENANT_ID, logging: loggingApi },
      security: { trustedOrigins: [] },
    },
    req: request,
  };
}

async function readBody(response: Response): Promise<{ code?: string }> {
  return (await response.json()) as { code?: string };
}

beforeAll(async () => {
  db = await createDb();
  await ensureAppRole(db);
});

afterAll(async () => {
  await db.close();
});

beforeEach(() => {
  audits.length = 0;
  vi.mocked(getBootstrap).mockResolvedValue(state(config()));
  vi.mocked(issueApiToken).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/token", () => {
  it("answers 404 when the config disables API clients", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(config({ enabled: false })));

    const response = (await handler(makeEvent(VALID_BODY))) as Response;

    expect(response.status).toBe(404);
    expect(await readBody(response)).toEqual({ code: "not_found" });
    expect(issueApiToken).not.toHaveBeenCalled();
  });

  it("answers 500 when the runtime has no project config", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(null));

    const response = (await handler(makeEvent(VALID_BODY))) as Response;

    expect(response.status).toBe(500);
    expect(await readBody(response)).toEqual({ code: "db_unavailable" });
  });

  it("answers 401 and audits a failed exchange when the credentials are rejected", async () => {
    vi.mocked(issueApiToken).mockResolvedValue(null);

    const response = (await handler(makeEvent(VALID_BODY))) as Response;

    expect(response.status).toBe(401);
    expect(await readBody(response)).toEqual({ code: "unauthorized" });
    expect(audits).toEqual([
      { operation: "auth:token:issue", outcome: "failed", errorCode: "unauthorized" },
    ]);
  });

  it("answers 429 with a retry-after once a client exhausts its window", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(
      state(config({ rateLimit: { windowMs: 60_000, maxRequests: 2 } })),
    );
    vi.mocked(issueApiToken).mockResolvedValue({
      accessToken: "at_fake_token",
      expiresAt: new Date(Date.now() + TTL_MS),
    });
    const body = { ...VALID_BODY, client_id: "rate-limited-client" };

    expect(((await handler(makeEvent(body))) as Response).status).toBe(200);
    expect(((await handler(makeEvent(body))) as Response).status).toBe(200);

    const response = (await handler(makeEvent(body))) as Response;

    expect(response.status).toBe(429);
    expect(await readBody(response)).toEqual({ code: "too_many_requests" });
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    // The limiter runs before the exchange: the denied attempt never reaches the database.
    expect(issueApiToken).toHaveBeenCalledTimes(2);
    expect(audits.at(-1)).toEqual({
      operation: "auth:token:issue",
      outcome: "failed",
      errorCode: "too_many_requests",
    });
  });

  it("returns the issued token with its expiry and no-store, auditing only the client id", async () => {
    vi.mocked(issueApiToken).mockResolvedValue({
      accessToken: "at_fake_token",
      expiresAt: new Date(Date.now() + TTL_MS),
    });

    const response = (await handler(makeEvent(VALID_BODY))) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      access_token: "at_fake_token",
      token_type: "Bearer",
      expires_in: TTL_MS / 1000,
    });
    expect(issueApiToken).toHaveBeenCalledWith(expect.anything(), {
      clientId: "client-1",
      clientSecret: "secret-1",
      ttlMs: TTL_MS,
    });
    expect(audits).toEqual([
      {
        operation: "auth:token:issue",
        outcome: "succeeded",
        details: { clientId: "client-1" },
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain("secret-1");
  });

  it("returns 400 invalid_input for a body that fails the Zod schema", async () => {
    const response = (await handler(
      makeEvent({ ...VALID_BODY, grant_type: "password" }),
    )) as Response;

    expect(response.status).toBe(400);
    const body = await readBody(response);
    expect(body.code).toBe("invalid_input");
    expect(getBootstrap).not.toHaveBeenCalled();
    expect(issueApiToken).not.toHaveBeenCalled();
  });
});
