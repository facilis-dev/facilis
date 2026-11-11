import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { AuthContext } from "@facilis.dev/auth";
import type { FacilisDb } from "@facilis.dev/db";

import type { FacilisHandlerEvent } from "./event.ts";
import type { JobsApi } from "./jobs.ts";
import { defineAuthorizedHandler } from "./route.ts";
import type { SudoHandler, SystemHandler, SystemOptions } from "./sudo.ts";

const dbMock = vi.hoisted(() => {
  const calls: { db: unknown; scope: unknown }[] = [];
  const elevatedDbs: unknown[] = [];
  const runWithPolicyScope = vi.fn(
    async (db: unknown, scope: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      calls.push({ db, scope });
      return fn({ scopedFor: scope });
    },
  );
  const runWithSystemRole = vi.fn(
    async (db: unknown, options: { sudoId: string }, fn: (tx: unknown) => Promise<unknown>) => {
      elevatedDbs.push(db);
      return fn({ systemFor: options.sudoId });
    },
  );
  return { calls, elevatedDbs, runWithPolicyScope, runWithSystemRole };
});

// Only the db transaction runners are mocked; the audit sink is the real implementation.
vi.mock("@facilis.dev/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis.dev/db")>();
  return {
    ...actual,
    runWithPolicyScope: dbMock.runWithPolicyScope,
    runWithSystemRole: dbMock.runWithSystemRole,
  };
});

import { resetSudoAuditSink, setSudoAuditSink, type SudoAuditEvent } from "@facilis.dev/db";

const SESSION_HASH = "b".repeat(64);
const AUTH: AuthContext = {
  userId: "00000000-0000-0000-0000-000000000001",
  roles: ["user"],
  permissions: ["orders:read"],
  sessionHash: SESSION_HASH,
};
const FAKE_DB = { driver: "pglite", close: async () => {} } as unknown as FacilisDb;
// The context middleware always attaches the queue; its identity is irrelevant to these tests.
const JOBS = { enqueue: vi.fn() } as unknown as JobsApi;

let audit: SudoAuditEvent[];
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dbMock.calls.length = 0;
  dbMock.elevatedDbs.length = 0;
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

describe("ctx.system", () => {
  it("runs elevated without a session and audits the named system actor", async () => {
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: ["users", "user_roles"] },
      async (_event, ctx) =>
        ctx.system(
          {
            actor: "system:auth",
            operation: "user:register",
            reason: "registration writes auth tables before a session exists",
            tables: ["users", "user_roles"],
          },
          async (systemDb) => ({ systemDb, ctxDb: ctx.db }),
        ),
    );

    const result = (await route({
      context: { auth: null, facilis: { db: FAKE_DB, defaultTenantId: "tenant-1", jobs: JOBS } },
      req: { headers: new Headers(), url: "http://localhost/api/auth/register", method: "POST" },
    })) as { systemDb: { systemFor: string }; ctxDb: unknown };

    expect(audit.map((entry) => entry.event)).toEqual(["started", "succeeded"]);
    const [started, succeeded] = audit;
    expect(started).toMatchObject({
      id: expect.any(String),
      actor: "system:auth",
      roles: [],
      tenantId: "tenant-1",
      route: "/api/auth/register",
      method: "POST",
      operation: "user:register",
      reason: "registration writes auth tables before a session exists",
      tables: ["users", "user_roles"],
    });
    expect(started?.actorUserId).toBeUndefined();
    expect(started?.sessionHash).toBeUndefined();
    expect(started?.permission).toBeUndefined();
    expect(result.systemDb.systemFor).toBe(started?.id);
    // The elevated callback runs on the policy-scoped request transaction, wrapped per
    // elevation by the table guard (D-157); it does not open another transaction.
    expect(dbMock.elevatedDbs[0]).toEqual({
      scopedFor: { tenantId: "tenant-1", permissions: [] },
    });
    expect(succeeded).toMatchObject({ id: started?.id, event: "succeeded", outcome: "succeeded" });
  });

  it("keeps the system actor when the route also has a session", async () => {
    const route = defineAuthorizedHandler(
      { permission: "orders:read", dbTables: ["users"] },
      async (_event, ctx) =>
        ctx.system(
          {
            actor: "system:maintenance",
            operation: "users:fix",
            reason: "repair",
            tables: ["users"],
          },
          async () => "done",
        ),
    );

    await route({
      context: { auth: AUTH, facilis: { db: FAKE_DB, defaultTenantId: "tenant-1", jobs: JOBS } },
      req: { headers: new Headers(), url: "http://localhost/api/users/fix", method: "POST" },
    });

    expect(audit[0]).toMatchObject({ actor: "system:maintenance", roles: [] });
    expect(audit[0]?.actorUserId).toBeUndefined();
    expect(audit[0]?.sessionHash).toBeUndefined();
  });

  it("validates the actor label, operation/reason and the dbTables subset", async () => {
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: ["users"] },
      async (_event, ctx) =>
        ctx.system(
          {
            actor: "user:not-system" as SystemOptions["actor"],
            operation: "user:register",
            reason: "why",
            tables: ["users"],
          },
          async () => "never",
        ),
    );

    const response = (await route({
      context: { auth: null, facilis: { db: FAKE_DB, jobs: JOBS } },
      req: { headers: new Headers(), url: "http://localhost/api/auth/register" },
    })) as Response;

    expect(response.status).toBe(500);
    expect(dbMock.runWithSystemRole).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("rejects tables outside the route's dbTables before auditing", async () => {
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: ["users"] },
      async (_event, ctx) =>
        ctx.system(
          {
            actor: "system:auth",
            operation: "user:register",
            reason: "why",
            tables: ["user_roles"],
          },
          async () => "never",
        ),
    );

    expect(
      (
        (await route({
          context: { auth: null, facilis: { db: FAKE_DB, jobs: JOBS } },
          req: { headers: new Headers(), url: "http://localhost/api/auth/register" },
        })) as Response
      ).status,
    ).toBe(500);
    expect(dbMock.runWithSystemRole).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
  });

  it("shares one nesting guard: system inside sudo is rejected", async () => {
    const route = defineAuthorizedHandler(
      { permission: "orders:read", dbTables: ["users"] },
      async (_event, ctx) =>
        ctx.sudo({ operation: "outer", reason: "why", tables: ["users"] }, async () =>
          ctx.system(
            { actor: "system:inner", operation: "inner", reason: "why", tables: ["users"] },
            async () => "never",
          ),
        ),
    );

    expect(
      (
        (await route({
          context: { auth: AUTH, facilis: { db: FAKE_DB, jobs: JOBS } },
          req: { headers: new Headers(), url: "http://localhost/api/outer" },
        })) as Response
      ).status,
    ).toBe(500);
    expect(dbMock.runWithSystemRole).toHaveBeenCalledTimes(1);
    expect(audit.map((entry) => entry.event)).toEqual(["started", "failed"]);
  });

  it("shares one nesting guard: sudo inside system is rejected", async () => {
    const route = defineAuthorizedHandler(
      { permission: "orders:read", dbTables: ["users"] },
      async (_event, ctx) =>
        ctx.system(
          { actor: "system:outer", operation: "outer", reason: "why", tables: ["users"] },
          async () =>
            ctx.sudo({ operation: "inner", reason: "why", tables: ["users"] }, async () => "never"),
        ),
    );

    expect(
      (
        (await route({
          context: { auth: AUTH, facilis: { db: FAKE_DB, jobs: JOBS } },
          req: { headers: new Headers(), url: "http://localhost/api/outer" },
        })) as Response
      ).status,
    ).toBe(500);
    expect(dbMock.runWithSystemRole).toHaveBeenCalledTimes(1);
    expect(audit.map((entry) => entry.event)).toEqual(["started", "failed"]);
  });

  it("never exposes the raw root client on the handler event", async () => {
    const outer = {
      context: { auth: null, facilis: { db: FAKE_DB, defaultTenantId: "tenant-1", jobs: JOBS } },
      req: { headers: new Headers(), url: "http://localhost/api/test", method: "GET" },
      res: { headers: new Headers() },
    };
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, async (event, ctx) => {
      expectTypeOf(event).toEqualTypeOf<FacilisHandlerEvent>();
      // The type has no db; this cast lets the test also prove it at runtime.
      const facilis = event.context.facilis as unknown as Record<string, unknown> | undefined;
      return {
        facilis: event.context.facilis,
        hasDb: facilis !== undefined && "db" in facilis,
        db: facilis?.["db"],
        scoped: ctx.db,
        reqShared: event.req === outer.req,
        resShared: event.res === outer.res,
      };
    });

    const result = (await route(outer)) as {
      facilis: unknown;
      hasDb: boolean;
      db: unknown;
      scoped: unknown;
      reqShared: boolean;
      resShared: boolean;
    };

    expect(result.facilis).toEqual({ defaultTenantId: "tenant-1" });
    expect(result.hasDb).toBe(false);
    expect(result.db).toBeUndefined();
    expect(result.scoped).toBeDefined();
    expect(result.reqShared).toBe(true);
    expect(result.resShared).toBe(true);
  });

  it("types both elevations on the handler context", () => {
    defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => {
      expectTypeOf(ctx.sudo).toEqualTypeOf<SudoHandler>();
      expectTypeOf(ctx.system).toEqualTypeOf<SystemHandler>();
      return null;
    });
  });
});
