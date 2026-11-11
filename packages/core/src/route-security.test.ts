import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AuthContext } from "@facilis.dev/auth";
import type { FacilisDb } from "@facilis.dev/db";

import type { FacilisEventContext, FacilisRequestEvent } from "./event.ts";
import { defineAuthorizedHandler } from "./route.ts";

const dbMock = vi.hoisted(() => {
  const runWithPolicyScope = vi.fn(
    async (_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
  );
  return { runWithPolicyScope };
});

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
  /** `null` omits the header; JSON bodies are the default media type. */
  contentType?: string | null;
  body?: unknown;
}

function makeEvent(options: FakeEventOptions = {}): FacilisRequestEvent {
  const headers = new Headers();
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  const req: FacilisRequestEvent["req"] = {
    headers,
    url: "http://localhost/api/test",
    method: "POST",
    json: async () => options.body,
  };
  const context: FacilisEventContext = { params: {} };
  if (options.auth !== undefined) context.auth = options.auth;
  context.facilis = { db: FAKE_DB };
  return { context, req };
}

async function readBody(response: Response): Promise<{ code?: string }> {
  return (await response.json()) as { code?: string };
}

beforeEach(() => {
  dbMock.runWithPolicyScope.mockClear();
});

describe("request-origin gate", () => {
  it("returns 403 for an authenticated cross-site POST", async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const route = defineAuthorizedHandler(
      { permission: "todos:read", dbTables: ["todos"] },
      handler,
    );
    const event = makeEvent({ auth: AUTH });
    event.req.headers.set("sec-fetch-site", "cross-site");

    const response = (await route(event)) as Response;

    expect(response.status).toBe(403);
    expect(await readBody(response)).toEqual({ code: "forbidden" });
    expect(handler).not.toHaveBeenCalled();
    expect(dbMock.runWithPolicyScope).not.toHaveBeenCalled();
  });

  it("checks the origin before the session, so a cross-site POST is forbidden not unauthorized", async () => {
    const route = defineAuthorizedHandler(
      { permission: "todos:read", dbTables: ["todos"] },
      () => null,
    );
    const event = makeEvent({ auth: null });
    event.req.headers.set("sec-fetch-site", "cross-site");

    const response = (await route(event)) as Response;

    expect(response.status).toBe(403);
    expect((await readBody(response)).code).toBe("forbidden");
  });

  it("lets a crossSite public route serve a cross-site POST", async () => {
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: [], crossSite: true },
      () => ({ ok: true }),
    );
    const event = makeEvent({ auth: null });
    event.req.headers.set("sec-fetch-site", "cross-site");

    expect(await route(event)).toEqual({ ok: true });
  });

  it("allows a POST whose Origin is in context.security.trustedOrigins", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, () => ({ ok: true }));
    const event = makeEvent();
    event.req.headers.set("origin", "https://app.example.com");
    event.context.security = { trustedOrigins: ["https://app.example.com"] };

    expect(await route(event)).toEqual({ ok: true });
  });

  it("accepts crossSite together with a non-empty permission (Bearer authenticates)", async () => {
    // v3a: a cross-site route may be authenticated, but only by a Bearer token; a session
    // cookie never crosses origins, so the wrapper no longer refuses the combination.
    const route = defineAuthorizedHandler(
      { permission: "todos:read", dbTables: [], crossSite: true },
      (_event, ctx) => ({ userId: ctx.auth.userId }),
    );

    expect(await route(makeEvent({ auth: AUTH }))).toEqual({ userId: AUTH.userId });
  });

  it("skips the origin gate only with originCheck: skip (framework protocol endpoints)", async () => {
    const skipped = defineAuthorizedHandler(
      { permission: [], dbTables: [], originCheck: "skip" },
      () => ({ ok: true }),
    );
    const enforced = defineAuthorizedHandler(
      { permission: [], dbTables: [], originCheck: "enforce" },
      () => ({ ok: true }),
    );
    const crossSite = (): FacilisRequestEvent => {
      const event = makeEvent();
      event.req.headers.set("sec-fetch-site", "cross-site");
      return event;
    };

    expect(await skipped(crossSite())).toEqual({ ok: true });
    expect(((await enforced(crossSite())) as Response).status).toBe(403);
  });
});

describe("request media type", () => {
  it("returns 415 when a JSON body route gets the wrong media type", async () => {
    const handler = vi.fn(() => null);
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: [], body: z.object({ title: z.string() }) },
      handler,
    );

    const response = (await route(makeEvent({ contentType: "text/plain", body: {} }))) as Response;

    expect(response.status).toBe(415);
    expect(await readBody(response)).toEqual({ code: "unsupported_media_type" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 415 when a JSON body route sends no content-type", async () => {
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: [], body: z.object({ title: z.string() }) },
      () => null,
    );

    const response = (await route(makeEvent({ contentType: null, body: {} }))) as Response;

    expect(response.status).toBe(415);
    expect(await readBody(response)).toEqual({ code: "unsupported_media_type" });
  });
});
