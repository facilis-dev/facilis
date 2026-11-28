import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FacilisDb } from "@facilis.dev/db";

import type { FacilisRequestEvent } from "./event.ts";
import { defineRawRoute } from "./raw-route.ts";
import { attachRequestDatabase } from "./request-database.ts";
import { isFacilisRouteHandler, SurfaceDeclarationError } from "./surface.ts";
import { DEFAULT_TENANT_ID } from "./tenancy.ts";

const dbMock = vi.hoisted(() => {
  const runWithPolicyScope = vi.fn(
    async (_db: unknown, scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ scopedFor: scope }),
  );
  return { runWithPolicyScope };
});

vi.mock("@facilis.dev/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis.dev/db")>();
  return { ...actual, runWithPolicyScope: dbMock.runWithPolicyScope };
});

const FAKE_DB = { driver: "pglite", close: async () => {} } as unknown as FacilisDb;

function makeEvent(headers: Record<string, string> = {}): FacilisRequestEvent {
  const event: FacilisRequestEvent = {
    context: {},
    req: {
      headers: new Headers({ "content-type": "application/json", ...headers }),
      url: "http://localhost/api/raw",
      method: "POST",
    },
  };
  event.context.facilis = { defaultTenantId: DEFAULT_TENANT_ID };
  attachRequestDatabase(event, FAKE_DB);
  return event;
}

async function body(response: Response): Promise<{ code?: string }> {
  return (await response.json()) as { code?: string };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dbMock.runWithPolicyScope.mockClear();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("defineRawRoute", () => {
  it("requires a non-empty reason, an explicit auth and no permission with auth none", () => {
    const handler = async () => "ok";
    expect(() => defineRawRoute({ reason: "  ", auth: "none" }, handler)).toThrow(
      SurfaceDeclarationError,
    );
    expect(() => defineRawRoute({ reason: "x", auth: "nope" as never }, handler)).toThrow(
      /auth must be/,
    );
    expect(() =>
      defineRawRoute({ reason: "x", auth: "none", permission: ["todos:read"] }, handler),
    ).toThrow(/cannot also declare a permission/);
  });

  it("brands the returned handler and rejects a lookalike", () => {
    const wrapped = defineRawRoute({ reason: "webhook", auth: "none" }, async () => "ok");
    expect(isFacilisRouteHandler(wrapped)).toBe(true);
    expect(isFacilisRouteHandler(async () => "ok")).toBe(false);
  });

  it("serves auth none anonymously and gives the handler the declared rawDb", async () => {
    const wrapped = defineRawRoute({ reason: "vendor callback", auth: "none" }, (_event, ctx) => {
      const db = ctx.rawDb({ reason: "vendor payload upsert" });
      return { scoped: (db as { scopedFor?: unknown }).scopedFor };
    });
    const response = await wrapped(makeEvent());
    expect((response as { scoped: unknown }).scoped).toMatchObject({});
  });

  it("rejects an anonymous request when auth is required", async () => {
    const wrapped = defineRawRoute({ reason: "webhook", auth: "required" }, async () => "ok");
    const response = (await wrapped(makeEvent())) as Response;
    expect(response.status).toBe(401);
    expect((await body(response)).code).toBe("unauthorized");
  });

  it("still applies the origin gate and the rate limit", async () => {
    const wrapped = defineRawRoute({ reason: "webhook", auth: "none" }, async () => "ok");
    const crossed = (await wrapped(
      makeEvent({ origin: "https://evil.example", host: "localhost" }),
    )) as Response;
    expect(crossed.status).toBe(403);
    expect((await body(crossed)).code).toBe("forbidden");

    const limited = defineRawRoute(
      { reason: "webhook", auth: "none", rateLimit: { windowMs: 60_000, maxRequests: 1 } },
      async () => "ok",
    );
    const event = makeEvent();
    event.context.facilis = { ...event.context.facilis, clientAddress: "203.0.113.7" };
    await limited(event);
    const second = (await limited(event)) as Response;
    expect(second.status).toBe(429);
  });

  it("fails the request when rawDb is called without a reason", async () => {
    const wrapped = defineRawRoute({ reason: "webhook", auth: "none" }, (_event, ctx) => {
      // A malformed declaration is a bug, not a silent widening: the wrapper refuses it.
      return ctx.rawDb({ reason: " " });
    });
    const response = (await wrapped(makeEvent())) as Response;
    expect(response.status).toBe(500);
    expect((await body(response)).code).toBe("internal_error");
  });
});
