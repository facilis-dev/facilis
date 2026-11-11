import { describe, expect, it, vi } from "vitest";
import type { FacilisDb } from "@facilis.dev/db";

import type { FacilisRequestEvent } from "./event.ts";
import { WorkflowError, type WorkflowsApi } from "./workflows.ts";
import { defineAuthorizedHandler } from "./route.ts";

// The wrapper only needs a transaction runner; workflow identity is the subject of this file.
const dbMock = vi.hoisted(() => ({
  runWithPolicyScope: vi.fn(
    async (_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
  ),
}));

vi.mock("@facilis.dev/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis.dev/db")>();
  return { ...actual, runWithPolicyScope: dbMock.runWithPolicyScope };
});

const FAKE_DB = { driver: "pglite", close: async () => {} } as unknown as FacilisDb;
const WORKFLOWS = { start: vi.fn() } as unknown as WorkflowsApi;

function makeEvent(workflows: WorkflowsApi | undefined): FacilisRequestEvent {
  return {
    context: {
      auth: null,
      facilis: { db: FAKE_DB, ...(workflows === undefined ? {} : { workflows }) },
    },
    req: { headers: new Headers(), url: "http://localhost/api/test", method: "POST" },
  };
}

describe("ctx.workflows", () => {
  it("passes the context's workflow API through to the handler", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => ({
      sameApi: ctx.workflows === WORKFLOWS,
    }));

    expect(await route(makeEvent(WORKFLOWS))).toEqual({ sameApi: true });
  });

  it("binds ctx.workflows to the request transaction", async () => {
    const bound = { start: vi.fn() } as unknown as WorkflowsApi;
    const bindScope = vi.fn(() => bound);
    const api = { ...WORKFLOWS, bindScope } as unknown as WorkflowsApi;
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => ({
      bound: ctx.workflows === bound,
    }));

    await expect(route(makeEvent(api))).resolves.toEqual({ bound: true });
    expect(bindScope).toHaveBeenCalledWith({});
  });

  it("does not fail the route when the runtime is missing; only workflow calls reject", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, async (_event, ctx) => {
      try {
        await ctx.workflows.start("order-approval", {});
        return { code: null };
      } catch (error) {
        return { code: error instanceof WorkflowError ? error.code : "unexpected" };
      }
    });

    expect(await route(makeEvent(undefined))).toEqual({ code: "workflow_unavailable" });
  });
});
