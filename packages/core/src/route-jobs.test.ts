import { describe, expect, it, vi } from "vitest";
import type { FacilisDb } from "@facilis/db";

import type { FacilisRequestEvent } from "./event.ts";
import { JobError, type JobsApi } from "./jobs.ts";
import { defineAuthorizedHandler } from "./route.ts";

// The wrapper only needs a transaction runner; jobs identity is the subject of this file.
const dbMock = vi.hoisted(() => ({
  runWithPolicyScope: vi.fn(
    async (_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
  ),
}));

vi.mock("@facilis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis/db")>();
  return { ...actual, runWithPolicyScope: dbMock.runWithPolicyScope };
});

const FAKE_DB = { driver: "pglite", close: async () => {} } as unknown as FacilisDb;
const JOBS = { enqueue: vi.fn() } as unknown as JobsApi;

function makeEvent(jobs: JobsApi | undefined): FacilisRequestEvent {
  return {
    context: {
      auth: null,
      facilis: { db: FAKE_DB, ...(jobs === undefined ? {} : { jobs }) },
    },
    req: { headers: new Headers(), url: "http://localhost/api/test", method: "POST" },
  };
}

describe("ctx.jobs", () => {
  it("passes the context's job API through to the handler", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => ({
      sameApi: ctx.jobs === JOBS,
    }));

    expect(await route(makeEvent(JOBS))).toEqual({ sameApi: true });
  });

  it("binds ctx.jobs to the request's policy transaction", async () => {
    const bound = { enqueue: vi.fn() } as unknown as JobsApi;
    const bindScope = vi.fn(() => bound);
    const api = { ...JOBS, bindScope } as unknown as JobsApi;
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => ({
      bound: ctx.jobs === bound,
    }));

    await expect(route(makeEvent(api))).resolves.toEqual({ bound: true });
    // The wrapper runs the handler inside its policy-scoped transaction ({ } in the mock).
    expect(bindScope).toHaveBeenCalledWith({});
  });

  it("does not fail the route when the runtime is missing; only job calls reject", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, async (_event, ctx) => {
      try {
        await ctx.jobs.stats();
        return { code: null };
      } catch (error) {
        return { code: error instanceof JobError ? error.code : "unexpected" };
      }
    });

    expect(await route(makeEvent(undefined))).toEqual({ code: "job_unavailable" });
  });
});
