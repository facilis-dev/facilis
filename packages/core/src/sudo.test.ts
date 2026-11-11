import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { AuthContext } from "@facilis.dev/auth";
import type { FacilisDb } from "@facilis.dev/db";

import type { FacilisRequestEvent } from "./event.ts";
import type { JobsApi } from "./jobs.ts";
import { defineAuthorizedHandler } from "./route.ts";
import type { SudoHandler } from "./sudo.ts";

const dbMock = vi.hoisted(() => {
  const calls: { db: unknown; scope: unknown }[] = [];
  const runWithPolicyScope = vi.fn(
    async (db: unknown, scope: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      calls.push({ db, scope });
      return fn({ scopedFor: scope });
    },
  );
  const runWithSystemRole = vi.fn(
    async (_db: unknown, options: { sudoId: string }, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ systemFor: options.sudoId }),
  );
  return { calls, runWithPolicyScope, runWithSystemRole };
});

// Only the db transaction runners are mocked: the audit sink and its fail-closed behaviour
// are the real @facilis.dev/db implementations, so the tests observe the production trail.
vi.mock("@facilis.dev/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis.dev/db")>();
  return {
    ...actual,
    runWithPolicyScope: dbMock.runWithPolicyScope,
    runWithSystemRole: dbMock.runWithSystemRole,
  };
});

import { resetSudoAuditSink, setSudoAuditSink, type SudoAuditEvent } from "@facilis.dev/db";

const SESSION_HASH = "a".repeat(64);

const AUTH: AuthContext = {
  userId: "00000000-0000-0000-0000-000000000001",
  roles: ["user"],
  permissions: ["orders:read"],
  sessionHash: SESSION_HASH,
};

const FAKE_DB = { driver: "pglite", close: async () => {} } as unknown as FacilisDb;
// The context middleware always attaches the queue; its identity is irrelevant to sudo tests.
const JOBS = { enqueue: vi.fn() } as unknown as JobsApi;

interface FakeEventOptions {
  auth?: AuthContext | null;
  requestId?: string;
  url?: string;
  method?: string;
}

function makeEvent(options: FakeEventOptions = {}): FacilisRequestEvent {
  const headers = new Headers();
  if (options.requestId !== undefined) headers.set("x-request-id", options.requestId);
  return {
    context: {
      auth: options.auth === undefined ? AUTH : options.auth,
      facilis: { db: FAKE_DB, defaultTenantId: "tenant-1", jobs: JOBS },
    },
    req: {
      headers,
      url: options.url ?? "http://localhost/api/order-requests",
      method: options.method ?? "POST",
    },
  };
}

async function readBody(response: Response): Promise<{ code?: string }> {
  return (await response.json()) as { code?: string };
}

let audit: SudoAuditEvent[];
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dbMock.calls.length = 0;
  dbMock.runWithPolicyScope.mockClear();
  dbMock.runWithSystemRole.mockClear();
  audit = [];
  setSudoAuditSink((event) => audit.push(event));
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetSudoAuditSink();
  consoleError.mockRestore();
});

describe("ctx.sudo", () => {
  it("runs the callback elevated and records started then succeeded", async () => {
    const route = defineAuthorizedHandler(
      { permission: "orders:read", dbTables: ["order_requests"] },
      async (_event, ctx) =>
        ctx.sudo(
          {
            operation: "order-request:create",
            reason: "users cannot write order_requests directly",
            tables: ["order_requests"],
          },
          async (systemDb) => ({ systemDb }),
        ),
    );

    const result = (await route(makeEvent({ requestId: "req-1" }))) as {
      systemDb: { systemFor: string };
    };

    expect(dbMock.runWithSystemRole).toHaveBeenCalledTimes(1);
    expect(audit.map((entry) => entry.event)).toEqual(["started", "succeeded"]);
    const [started, succeeded] = audit;
    expect(started).toMatchObject({
      id: expect.any(String),
      at: expect.any(String),
      actor: `user:${AUTH.userId}`,
      actorUserId: AUTH.userId,
      sessionHash: SESSION_HASH,
      roles: ["user"],
      tenantId: "tenant-1",
      route: "/api/order-requests",
      method: "POST",
      permission: "orders:read",
      requestId: "req-1",
      operation: "order-request:create",
      reason: "users cannot write order_requests directly",
      tables: ["order_requests"],
    });
    expect(started?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The callback gets a distinct elevated client carrying the audit id.
    expect(result.systemDb.systemFor).toBe(started?.id);
    expect(succeeded).toMatchObject({
      id: started?.id,
      event: "succeeded",
      outcome: "succeeded",
      durationMs: expect.any(Number),
    });
    // The session permissions travel in the scope for permission views (D-098).
    expect(dbMock.calls[0]?.scope).toMatchObject({
      tenantId: "tenant-1",
      userId: AUTH.userId,
      permissions: AUTH.permissions,
    });
  });

  it("audits failed and rethrows when the elevated callback throws", async () => {
    const route = defineAuthorizedHandler(
      { permission: "orders:read", dbTables: ["order_requests"] },
      async (_event, ctx) =>
        ctx.sudo(
          { operation: "order-request:create", reason: "why", tables: ["order_requests"] },
          async () => {
            throw new Error("unique violation");
          },
        ),
    );

    const response = (await route(makeEvent())) as Response;

    expect(response.status).toBe(500);
    expect(await readBody(response)).toEqual({ code: "internal_error" });
    expect(audit.map((entry) => entry.event)).toEqual(["started", "failed"]);
    expect(audit[1]).toMatchObject({
      event: "failed",
      outcome: "failed",
      errorCode: "handler_failed",
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(audit)).not.toContain("unique violation");
    expect(consoleError).toHaveBeenCalledWith(
      "facilis: authorized handler failed",
      expect.any(Error),
    );
  });

  it("rejects tables outside the route's dbTables before auditing or escalating", async () => {
    const route = defineAuthorizedHandler(
      { permission: "orders:read", dbTables: ["order_requests"] },
      async (_event, ctx) =>
        ctx.sudo(
          { operation: "order-request:create", reason: "why", tables: ["users"] },
          async () => "never",
        ),
    );

    const response = (await route(makeEvent())) as Response;

    expect(response.status).toBe(500);
    expect(dbMock.runWithSystemRole).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("rejects an empty operation or reason", async () => {
    const route = defineAuthorizedHandler(
      { permission: "orders:read", dbTables: ["order_requests"] },
      async (_event, ctx) =>
        ctx.sudo(
          { operation: " ", reason: "why", tables: ["order_requests"] },
          async () => "never",
        ),
    );

    expect(((await route(makeEvent())) as Response).status).toBe(500);
    expect(dbMock.runWithSystemRole).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("refuses a nested sudo and audits the outer failure", async () => {
    const route = defineAuthorizedHandler(
      { permission: "orders:read", dbTables: ["order_requests"] },
      async (_event, ctx) =>
        ctx.sudo({ operation: "outer", reason: "why", tables: ["order_requests"] }, async () =>
          ctx.sudo(
            { operation: "inner", reason: "why", tables: ["order_requests"] },
            async () => "never",
          ),
        ),
    );

    const response = (await route(makeEvent())) as Response;

    expect(response.status).toBe(500);
    expect(dbMock.runWithSystemRole).toHaveBeenCalledTimes(1);
    expect(audit.map((entry) => entry.event)).toEqual(["started", "failed"]);
  });

  it("fails closed when the audit sink throws, before the role switch", async () => {
    setSudoAuditSink(() => {
      throw new Error("sink down");
    });
    const elevated = vi.fn();
    const route = defineAuthorizedHandler(
      { permission: "orders:read", dbTables: ["order_requests"] },
      async (_event, ctx) =>
        ctx.sudo(
          { operation: "order-request:create", reason: "why", tables: ["order_requests"] },
          async () => {
            elevated();
            return "never";
          },
        ),
    );

    const response = (await route(makeEvent())) as Response;

    expect(response.status).toBe(500);
    expect(dbMock.runWithSystemRole).not.toHaveBeenCalled();
    expect(elevated).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "facilis: authorized handler failed",
      expect.any(Error),
    );
  });

  it("refuses sudo without a session (system callers use runAsSystem)", async () => {
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: ["order_requests"] },
      async (_event, ctx) =>
        ctx.sudo(
          {
            operation: "public:notify",
            reason: "a public route has no session to audit",
            tables: ["order_requests"],
          },
          async () => "never",
        ),
    );

    const response = (await route(makeEvent({ auth: null }))) as Response;

    expect(response.status).toBe(401);
    expect(dbMock.runWithSystemRole).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("types ctx.sudo as the elevation handler", () => {
    defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => {
      expectTypeOf(ctx.sudo).toEqualTypeOf<SudoHandler>();
      return null;
    });
  });
});
