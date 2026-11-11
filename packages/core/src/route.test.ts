import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import type { AuthContext } from "@facilis.dev/auth";
import type { FacilisDb } from "@facilis.dev/db";

import type { FacilisEventContext, FacilisHandlerEvent, FacilisRequestEvent } from "./event.ts";
import {
  defineAuthorizedHandler,
  type AuthorizedHandlerConfig,
  type AuthorizedHandlerContext,
} from "./route.ts";
import { DEFAULT_TENANT_ID } from "./tenancy.ts";

const dbMock = vi.hoisted(() => {
  const calls: { db: unknown; scope: unknown }[] = [];
  const runWithPolicyScope = vi.fn(
    async (db: unknown, scope: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      calls.push({ db, scope });
      return fn({ scopedFor: scope });
    },
  );
  return { calls, runWithPolicyScope };
});

// Only the transaction runner is mocked: RBAC is a pure function exercised against the
// real @facilis.dev/auth implementation, and auth's tables need the real RLS helpers from db.
vi.mock("@facilis.dev/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis.dev/db")>();
  return { ...actual, runWithPolicyScope: dbMock.runWithPolicyScope };
});

const FAKE_DB = { driver: "pglite", close: async () => {} } as unknown as FacilisDb;

const AUTH: AuthContext = {
  userId: "00000000-0000-0000-0000-000000000001",
  roles: ["user"],
  permissions: ["todos:read"],
};

interface FakeEventOptions {
  auth?: AuthContext | null;
  db?: FacilisDb | null;
  defaultTenantId?: string;
  params?: Record<string, string>;
  url?: string;
  hasBody?: boolean;
  body?: unknown;
  bodyReaderFails?: boolean;
}

function makeEvent(options: FakeEventOptions = {}): FacilisRequestEvent {
  const req: FacilisRequestEvent["req"] = {
    // A body-carrying route requires the JSON media type before the body is read.
    headers: new Headers({ "content-type": "application/json" }),
    url: options.url ?? "http://localhost/api/test",
    method: "POST",
  };
  if (options.bodyReaderFails) {
    req.json = async () => {
      throw new Error("invalid json");
    };
  } else if (options.hasBody) {
    req.json = async () => options.body;
  }
  const context: FacilisEventContext = { params: options.params ?? {} };
  if (options.auth !== undefined) context.auth = options.auth;
  if (options.db !== null) {
    context.facilis = { db: options.db ?? FAKE_DB, defaultTenantId: options.defaultTenantId };
  }
  return { context, req };
}

async function readBody(response: Response): Promise<{ code?: string; details?: unknown }> {
  return (await response.json()) as { code?: string; details?: unknown };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dbMock.calls.length = 0;
  dbMock.runWithPolicyScope.mockClear();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("defineAuthorizedHandler", () => {
  it("returns 401 for a privileged route without a session", async () => {
    const handler = vi.fn();
    const route = defineAuthorizedHandler(
      { permission: "todos:read", dbTables: ["todos"] },
      handler,
    );

    const response = (await route(makeEvent({ auth: null }))) as Response;

    expect(response.status).toBe(401);
    expect(await readBody(response)).toEqual({ code: "unauthorized" });
    expect(handler).not.toHaveBeenCalled();
    expect(dbMock.runWithPolicyScope).not.toHaveBeenCalled();
  });

  it("returns 403 when the session lacks every required permission", async () => {
    const route = defineAuthorizedHandler(
      { permission: "todos:write", dbTables: ["todos"] },
      () => ({ ok: true }),
    );

    const response = (await route(makeEvent({ auth: AUTH }))) as Response;

    expect(response.status).toBe(403);
    expect(await readBody(response)).toEqual({ code: "forbidden" });
  });

  it("accepts a permission array when at least one entry matches", async () => {
    const route = defineAuthorizedHandler(
      { permission: ["todos:write", "todos:read"], dbTables: ["todos"] },
      () => ({ ok: true }),
    );

    expect(await route(makeEvent({ auth: AUTH }))).toEqual({ ok: true });
  });

  it("runs a public route without a session and passes a null auth", async () => {
    const handler = vi.fn(
      (
        _event: FacilisHandlerEvent,
        ctx: AuthorizedHandlerContext<void, void, void, AuthContext | null>,
      ) => ({
        auth: ctx.auth,
        db: ctx.db,
      }),
    );
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, handler);

    const result = (await route(makeEvent({ auth: null }))) as {
      auth: AuthContext | null;
      db: { scopedFor: unknown };
    };

    expect(result.auth).toBeNull();
    // O-003: anonymous requests fall back to the framework single-tenant id (RLS WITH CHECK).
    expect(result.db.scopedFor).toEqual({ tenantId: DEFAULT_TENANT_ID, permissions: [] });
    expect(dbMock.calls).toHaveLength(1);
  });

  it("scopes unauthenticated requests to the configured default tenant", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: ["users"] }, () => null);

    await route(makeEvent({ auth: null, defaultTenantId: "tenant-default" }));

    expect(dbMock.calls[0]?.scope).toEqual({ tenantId: "tenant-default", permissions: [] });
  });

  it("scopes authenticated requests to the deployment tenant, with user and roles", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, () => null);

    // D-040: the session cannot widen or change the tenant; only the deployment value counts.
    await route(makeEvent({ auth: AUTH, defaultTenantId: "tenant-default" }));

    expect(dbMock.calls[0]?.scope).toEqual({ tenantId: "tenant-default", ...AUTH });
  });

  it("validates params, query and body and passes parsed values to the handler", async () => {
    const handler = vi.fn(
      (_event: FacilisHandlerEvent, ctx: { body: unknown; query: unknown; params: unknown }) => ({
        body: ctx.body,
        query: ctx.query,
        params: ctx.params,
      }),
    );
    const route = defineAuthorizedHandler(
      {
        permission: [],
        dbTables: ["todos"],
        params: z.object({ id: z.string().uuid() }),
        query: z.object({ limit: z.coerce.number().int() }),
        body: z.object({ title: z.string().min(1) }),
      },
      handler,
    );
    const id = "00000000-0000-4000-8000-000000000003";
    const event = makeEvent({
      auth: null,
      params: { id },
      url: "http://localhost/api/todos?limit=5",
      hasBody: true,
      body: { title: "write tests" },
    });

    expect(await route(event)).toEqual({
      body: { title: "write tests" },
      query: { limit: 5 },
      params: { id },
    });
  });

  it("returns 400 invalid_input with flattened issues for an invalid body", async () => {
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: [], body: z.object({ title: z.string() }) },
      () => null,
    );

    const response = (await route(makeEvent({ hasBody: true, body: { title: 42 } }))) as Response;
    const body = await readBody(response);

    expect(response.status).toBe(400);
    expect(body.code).toBe("invalid_input");
    expect(body.details).toMatchObject({ fieldErrors: { title: expect.any(Array) } });
    expect(dbMock.runWithPolicyScope).not.toHaveBeenCalled();
  });

  it("returns 400 for unparsable JSON instead of throwing", async () => {
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: [], body: z.object({ title: z.string() }) },
      () => null,
    );

    const response = (await route(makeEvent({ bodyReaderFails: true }))) as Response;

    expect(response.status).toBe(400);
    expect(await readBody(response)).toEqual({
      code: "invalid_input",
      details: { formErrors: ["Request body must be valid JSON"] },
    });
  });

  it("checks permissions before input validation", async () => {
    const route = defineAuthorizedHandler(
      { permission: "todos:write", dbTables: [], body: z.object({ title: z.string() }) },
      () => null,
    );

    const response = (await route(makeEvent({ auth: AUTH, hasBody: true, body: {} }))) as Response;

    expect(response.status).toBe(403);
  });

  it("returns 500 db_unavailable when the context has no database", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, () => null);

    const response = (await route(makeEvent({ db: null }))) as Response;

    expect(response.status).toBe(500);
    expect(await readBody(response)).toEqual({ code: "db_unavailable" });
  });

  it("passes handler return values through unchanged", async () => {
    const value = { id: "todo-1", done: false };
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, () => value);

    expect(await route(makeEvent())).toBe(value);
  });

  it("wraps thrown errors as internal_error and logs them", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, () => {
      throw new Error("database exploded");
    });

    const response = (await route(makeEvent())) as Response;
    const body = await readBody(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({ code: "internal_error" });
    expect(consoleError).toHaveBeenCalledWith(
      "facilis: authorized handler failed",
      expect.any(Error),
    );
  });

  it("lets a thrown Response through untouched", async () => {
    const teapot = new Response("teapot", { status: 418 });
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, () => {
      throw teapot;
    });

    expect(await route(makeEvent())).toBe(teapot);
  });

  it("types ctx.auth per overload: nullable for public routes, non-null otherwise", () => {
    defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => {
      expectTypeOf(ctx.auth).toEqualTypeOf<AuthContext | null>();
      return null;
    });
    defineAuthorizedHandler({ permission: "todos:read", dbTables: ["todos"] }, (_event, ctx) => {
      expectTypeOf(ctx.auth).toEqualTypeOf<AuthContext>();
      return null;
    });
    expectTypeOf<{
      permission: string;
      dbTables: readonly string[];
    }>().toMatchTypeOf<AuthorizedHandlerConfig>();
  });
});
