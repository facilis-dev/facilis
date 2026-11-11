import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@facilis.dev/auth";
import type { FacilisDb } from "@facilis.dev/db";

import type { FacilisRequestEvent } from "./event.ts";
import { defineAuthorizedHandler } from "./route.ts";

const dbMock = vi.hoisted(() => {
  const state: { systemTx: unknown } = { systemTx: undefined };
  const runWithPolicyScope = vi.fn(
    async (_db: unknown, scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ scopedFor: scope }),
  );
  const runWithSystemRole = vi.fn(
    async (_db: unknown, options: { sudoId: string }, fn: (tx: unknown) => Promise<unknown>) =>
      fn(state.systemTx ?? { systemFor: options.sudoId }),
  );
  return { state, runWithPolicyScope, runWithSystemRole };
});

// Only the db transaction runners are mocked: the guard, its error and the audit sink are real.
vi.mock("@facilis.dev/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis.dev/db")>();
  return {
    ...actual,
    runWithPolicyScope: dbMock.runWithPolicyScope,
    runWithSystemRole: dbMock.runWithSystemRole,
  };
});

import { resetSudoAuditSink, setSudoAuditSink, type SudoAuditEvent } from "@facilis.dev/db";

const AUTH: AuthContext = {
  userId: "00000000-0000-0000-0000-000000000001",
  roles: ["user"],
  permissions: ["orders:read"],
};

const FAKE_DB = { driver: "pglite", close: async () => {} } as unknown as FacilisDb;

/** Drizzle 0.45's table identity is the entityKind symbol plus the table-name symbols. */
const TABLE_ENTITY_KIND = Symbol.for("drizzle:entityKind");
function FakeTable(): void {
  // The constructor exists only to give the fake table a Drizzle-compatible entityKind.
}
Object.defineProperty(FakeTable, TABLE_ENTITY_KIND, { value: "Table" });

function fakeTable(name: string): object {
  const table = Object.create(FakeTable.prototype) as Record<symbol, unknown>;
  table[Symbol.for("drizzle:IsDrizzleTable")] = true;
  table[Symbol.for("drizzle:Name")] = name;
  table[Symbol.for("drizzle:OriginalName")] = name;
  table[Symbol.for("drizzle:IsAlias")] = false;
  return table;
}

function fakeSystemDb(relation: string): object {
  return { query: { [relation]: { table: fakeTable(relation) } } };
}

function makeEvent(): FacilisRequestEvent {
  return {
    context: {
      auth: AUTH,
      facilis: { db: FAKE_DB, defaultTenantId: "tenant-1" },
    },
    req: { headers: new Headers(), url: "http://localhost/api/orders", method: "POST" },
  };
}

async function readBody(response: Response): Promise<{ code?: string }> {
  return (await response.json()) as { code?: string };
}

let audit: SudoAuditEvent[];

beforeEach(() => {
  dbMock.state.systemTx = undefined;
  dbMock.runWithPolicyScope.mockClear();
  dbMock.runWithSystemRole.mockClear();
  audit = [];
  setSudoAuditSink((event) => audit.push(event));
});

afterEach(() => {
  resetSudoAuditSink();
});

describe("ctx.sudo table guard", () => {
  it("records the observed tables on the succeeded audit entry", async () => {
    dbMock.state.systemTx = fakeSystemDb("order_requests");
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: ["order_requests"] },
      async (_event, ctx) =>
        ctx.sudo(
          {
            operation: "order:read",
            reason: "audit needs the declared table",
            tables: ["order_requests"],
          },
          async (systemDb) => {
            const relational = systemDb as unknown as {
              query: { order_requests: unknown };
            };
            void relational.query.order_requests;
            return "ok";
          },
        ),
    );

    expect(await route(makeEvent())).toBe("ok");
    expect(audit.map((entry) => entry.event)).toEqual(["started", "succeeded"]);
    expect(audit[1]).toMatchObject({
      event: "succeeded",
      outcome: "succeeded",
      observedTables: ["order_requests"],
    });
  });

  it("inherits the route's rawSql exception inside the elevation", async () => {
    const execute = vi.fn(async () => ({ rows: [{ ok: 1 }] }));
    dbMock.state.systemTx = { execute };
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: ["order_requests"], rawSql: true },
      async (_event, ctx) =>
        ctx.sudo(
          {
            operation: "order:raw",
            reason: "an allow-listed raw statement",
            tables: ["order_requests"],
          },
          async (systemDb) => {
            const result = await systemDb.execute({} as never);
            return result.rows.length;
          },
        ),
    );

    expect(await route(makeEvent())).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the elevated callback reaches outside options.tables", async () => {
    dbMock.state.systemTx = fakeSystemDb("users");
    const route = defineAuthorizedHandler(
      { permission: [], dbTables: ["order_requests", "users"] },
      async (_event, ctx) =>
        ctx.sudo(
          {
            operation: "order:read",
            reason: "only the order table is in scope",
            tables: ["order_requests"],
          },
          async (systemDb) => {
            const relational = systemDb as unknown as { query: { users: unknown } };
            void relational.query.users;
            return "never";
          },
        ),
    );

    const response = (await route(makeEvent())) as Response;

    expect(response.status).toBe(500);
    expect(await readBody(response)).toEqual({ code: "table_not_declared" });
    expect(audit.map((entry) => entry.event)).toEqual(["started", "failed"]);
    expect(audit[1]).toMatchObject({
      event: "failed",
      outcome: "failed",
      errorCode: "table_not_declared",
    });
    expect(JSON.stringify(audit)).not.toContain("users");
  });
});
