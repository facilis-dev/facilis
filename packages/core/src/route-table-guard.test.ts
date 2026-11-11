import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@facilis/auth";
import type { FacilisDb } from "@facilis/db";

import type { FacilisEventContext, FacilisRequestEvent } from "./event.ts";
import type { FacilisLoggingApi } from "./logging.ts";
import { defineAuthorizedHandler } from "./route.ts";

const dbMock = vi.hoisted(() => {
  const state: { tx: unknown } = { tx: undefined };
  const runWithPolicyScope = vi.fn(
    async (_db: unknown, scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn(state.tx ?? { scopedFor: scope }),
  );
  return { state, runWithPolicyScope };
});

// Only the transaction runner is mocked: the table guard and its error class stay real.
vi.mock("@facilis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facilis/db")>();
  return { ...actual, runWithPolicyScope: dbMock.runWithPolicyScope };
});

import { TableAccessError } from "@facilis/db";

const AUTH: AuthContext = {
  userId: "00000000-0000-0000-0000-000000000001",
  roles: ["user"],
  permissions: [],
};

const FAKE_DB = { driver: "pglite", close: async () => {} } as unknown as FacilisDb;

interface AuditCapture {
  readonly logging: FacilisLoggingApi;
  readonly audit: ReturnType<typeof vi.fn>;
}

function captureAudit(): AuditCapture {
  const audit = vi.fn();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    audit,
  };
  return { logging: { record: vi.fn(), logger: () => logger }, audit };
}

function makeEvent(logging: FacilisLoggingApi): FacilisRequestEvent {
  const context: FacilisEventContext = {
    auth: AUTH,
    facilis: { db: FAKE_DB, defaultTenantId: "tenant-1", logging },
  };
  return {
    context,
    req: { headers: new Headers(), url: "http://localhost/api/guard", method: "POST" },
  };
}

async function readBody(response: Response): Promise<{ code?: string }> {
  return (await response.json()) as { code?: string };
}

beforeEach(() => {
  dbMock.state.tx = undefined;
  dbMock.runWithPolicyScope.mockClear();
});

describe("route table guard", () => {
  it("refuses db.execute without rawSql and audits the canonical code", async () => {
    const { logging, audit } = captureAudit();
    const execute = vi.fn(async () => ({ rows: [] }));
    dbMock.state.tx = { execute };

    const route = defineAuthorizedHandler(
      { permission: [], dbTables: ["todos"] },
      async (_event, ctx) => {
        await ctx.db.execute({} as never);
        return { ok: true };
      },
    );

    const response = (await route(makeEvent(logging))) as Response;

    expect(response.status).toBe(500);
    expect(await readBody(response)).toEqual({ code: "raw_sql_not_allowed" });
    expect(execute).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith({
      operation: "route:table_access",
      outcome: "failed",
      errorCode: "raw_sql_not_allowed",
    });
  });

  it("lets db.execute through with rawSql: true", async () => {
    const { logging } = captureAudit();
    const execute = vi.fn(async () => ({ rows: [{ ok: 1 }] }));
    dbMock.state.tx = { execute };

    const route = defineAuthorizedHandler(
      { permission: [], dbTables: [], rawSql: true },
      async (_event, ctx) => {
        const result = await ctx.db.execute({} as never);
        return { rows: result.rows.length };
      },
    );

    expect(await route(makeEvent(logging))).toEqual({ rows: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("maps table_not_declared to a 500 without exposing the relation name", async () => {
    const { logging, audit } = captureAudit();
    const route = defineAuthorizedHandler({ permission: [], dbTables: ["todos"] }, () => {
      throw new TableAccessError("table_not_declared", "secret_table");
    });

    const response = (await route(makeEvent(logging))) as Response;
    const body = await readBody(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({ code: "table_not_declared" });
    expect(JSON.stringify(body)).not.toContain("secret_table");
    expect(audit).toHaveBeenCalledWith({
      operation: "route:table_access",
      outcome: "failed",
      errorCode: "table_not_declared",
    });
  });
});
