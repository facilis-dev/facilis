import { describe, expect, it, vi } from "vitest";

import type { FacilisDb } from "@facilis.dev/db";

import { defineAuthorizedHandler } from "./route.ts";
import type { FacilisEventContext, FacilisRequestEvent } from "./event.ts";

/**
 * The wrapper throttle (D-152): the limiter is module-level (one process) and keyed by
 * METHOD + path + client address, so these tests use distinct paths and addresses instead of
 * resetting it. Only the transaction runner is mocked: the deny path never reaches it.
 */
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

interface EventOptions {
  readonly path: string;
  readonly clientAddress?: string;
}

function makeEvent(options: EventOptions): FacilisRequestEvent {
  const context: FacilisEventContext = {
    params: {},
    facilis: {
      db: FAKE_DB,
      defaultTenantId: "tenant-1",
      ...(options.clientAddress === undefined ? {} : { clientAddress: options.clientAddress }),
    },
  };
  return {
    context,
    req: {
      headers: new Headers(),
      url: `http://localhost${options.path}`,
      method: "POST",
    },
  };
}

function handler(limit: { maxRequests: number; windowMs: number }) {
  return defineAuthorizedHandler({ permission: [], dbTables: [], rateLimit: limit }, async () => ({
    ok: true,
  }));
}

async function codeOf(response: unknown): Promise<{ status: number; code?: string }> {
  if (!(response instanceof Response)) throw new Error("expected a Response");
  const body = (await response.json()) as { code?: string };
  return { status: response.status, ...(body.code === undefined ? {} : { code: body.code }) };
}

describe("defineAuthorizedHandler rateLimit", () => {
  it("denies past the window with 429 and a retry-after, before the handler runs", async () => {
    const run = handler({ maxRequests: 2, windowMs: 60_000 });
    const options = { path: "/api/rate-limit-denied", clientAddress: "203.0.113.1" };

    await expect(run(makeEvent(options))).resolves.toEqual({ ok: true });
    await expect(run(makeEvent(options))).resolves.toEqual({ ok: true });
    const denied = await run(makeEvent(options));
    if (!(denied instanceof Response)) throw new Error("expected the third call to be denied");

    expect(denied.status).toBe(429);
    await expect(denied.json()).resolves.toEqual({ code: "too_many_requests" });
    // The window is one minute: the remainder is reported so a client can wait exactly that long.
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(Number(denied.headers.get("retry-after"))).toBeLessThanOrEqual(60);
  }, 10_000);

  it("tracks one window per client address, so one caller cannot exhaust another's budget", async () => {
    const run = handler({ maxRequests: 1, windowMs: 60_000 });
    const path = "/api/rate-limit-per-client";

    await expect(run(makeEvent({ path, clientAddress: "203.0.113.2" }))).resolves.toEqual({
      ok: true,
    });
    await expect(run(makeEvent({ path, clientAddress: "203.0.113.3" }))).resolves.toEqual({
      ok: true,
    });
    expect(await codeOf(await run(makeEvent({ path, clientAddress: "203.0.113.2" })))).toEqual({
      status: 429,
      code: "too_many_requests",
    });
  }, 10_000);

  it("skips the throttle when the middleware resolved no client address", async () => {
    const run = handler({ maxRequests: 1, windowMs: 60_000 });
    const path = "/api/rate-limit-no-address";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(run(makeEvent({ path }))).resolves.toEqual({ ok: true });
    }
  });

  it("keeps windows separate per route, even for the same client", async () => {
    const run = handler({ maxRequests: 1, windowMs: 60_000 });
    const clientAddress = "203.0.113.4";

    await expect(
      run(makeEvent({ path: "/api/rate-limit-route-a", clientAddress })),
    ).resolves.toEqual({ ok: true });
    await expect(
      run(makeEvent({ path: "/api/rate-limit-route-b", clientAddress })),
    ).resolves.toEqual({ ok: true });
  });
});
