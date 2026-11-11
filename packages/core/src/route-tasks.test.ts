import { describe, expect, it, vi } from "vitest";
import type { FacilisDb } from "@facilis.dev/db";

import type { FacilisRequestEvent } from "./event.ts";
import { TaskError, type TasksApi } from "./tasks.ts";
import { defineAuthorizedHandler } from "./route.ts";

// The wrapper only needs a transaction runner; task identity is the subject of this file.
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
const TASKS = { request: vi.fn() } as unknown as TasksApi;

function makeEvent(
  tasks: TasksApi | undefined,
  auth: FacilisRequestEvent["context"]["auth"] = null,
): FacilisRequestEvent {
  return {
    context: {
      auth,
      facilis: { db: FAKE_DB, ...(tasks === undefined ? {} : { tasks }) },
    },
    req: { headers: new Headers(), url: "http://localhost/api/test", method: "POST" },
  };
}

const USER = { userId: "user-1", roles: [], permissions: [] };

describe("ctx.tasks", () => {
  it("passes the context's task API through to the handler", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => ({
      sameApi: ctx.tasks === TASKS,
    }));

    expect(await route(makeEvent(TASKS))).toEqual({ sameApi: true });
  });

  it("binds ctx.tasks to the request transaction and the session actor", async () => {
    const bound = { request: vi.fn() } as unknown as TasksApi;
    const bindScope = vi.fn(() => bound);
    const api = { ...TASKS, bindScope } as unknown as TasksApi;
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => ({
      bound: ctx.tasks === bound,
    }));

    await expect(route(makeEvent(api, USER))).resolves.toEqual({ bound: true });
    expect(bindScope).toHaveBeenCalledWith({}, { actor: "user-1" });
  });

  it("binds a null actor for an anonymous route", async () => {
    const bindScope = vi.fn(() => TASKS);
    const api = { ...TASKS, bindScope } as unknown as TasksApi;
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, (_event, ctx) => ({
      sameApi: ctx.tasks === TASKS,
    }));

    await expect(route(makeEvent(api))).resolves.toEqual({ sameApi: true });
    expect(bindScope).toHaveBeenCalledWith({}, { actor: null });
  });

  it("does not fail the route when the runtime is missing; only task calls reject", async () => {
    const route = defineAuthorizedHandler({ permission: [], dbTables: [] }, async (_event, ctx) => {
      try {
        await ctx.tasks.request({ titleKey: "todos.approval" });
        return { code: null };
      } catch (error) {
        return { code: error instanceof TaskError ? error.code : "unexpected" };
      }
    });

    expect(await route(makeEvent(undefined))).toEqual({ code: "task_unavailable" });
  });
});
