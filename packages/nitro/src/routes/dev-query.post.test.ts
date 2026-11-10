import type { H3Event } from "nitro";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOGGING_CONFIG, NOOP_LOGGING_API } from "@facilis/core";
import { applyStatements, createDb, type FacilisDb } from "@facilis/db";

vi.mock("../runtime/bootstrap.ts", () => ({ getBootstrap: vi.fn() }));

import { getBootstrap, type BootstrapState } from "../runtime/bootstrap.ts";
import handler from "./dev-query.post.ts";

const ORIGINAL_ENV = process.env.NODE_ENV;

function event(payload: unknown, origin?: string): H3Event {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  const json =
    payload === undefined
      ? () => Promise.reject(new Error("no body"))
      : () => Promise.resolve(payload);
  return { req: { headers, json } } as unknown as H3Event;
}

function state(db: FacilisDb | null): BootstrapState {
  return {
    db,
    config: null,
    warnings: [],
    startedAt: "2026-11-06T00:00:00.000Z",
    jobs: null,
    tasks: null,
    storage: null,
    logging: NOOP_LOGGING_API,
    loggingConfig: DEFAULT_LOGGING_CONFIG,
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("dev-query route", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createDb();
    await applyStatements(db, [
      "CREATE TABLE items (id uuid PRIMARY KEY, title text NOT NULL, created_at timestamptz)",
      "INSERT INTO items (id, title, created_at) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'one', '2026-11-06T10:00:00Z')",
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    vi.mocked(getBootstrap).mockReset();
  });

  it("answers 404 in production without booting the runtime", async () => {
    process.env.NODE_ENV = "production";
    const response = await handler(event({ sql: "select 1 as n" }));
    expect(response.status).toBe(404);
    expect(await body(response)).toEqual({ code: "not_found" });
    expect(getBootstrap).not.toHaveBeenCalled();
  });

  it("answers 403 when the origin is not allowed", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const response = await handler(event({ sql: "select 1 as n" }, "https://evil.example"));
    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ code: "forbidden" });
  });

  it("answers 503 db_unavailable when the runtime has no database", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(null));
    const response = await handler(event({ sql: "select 1 as n" }));
    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({ code: "db_unavailable" });
  });

  it("answers 400 invalid_body for a missing or malformed body", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));

    const noBody = await handler(event(undefined));
    expect(noBody.status).toBe(400);
    expect(await body(noBody)).toEqual({ code: "invalid_body" });

    const wrongType = await handler(event({ sql: 42 }));
    expect(wrongType.status).toBe(400);
    expect((await body(wrongType))["code"]).toBe("invalid_body");
  });

  it("answers 400 invalid_sql for a write", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const response = await handler(event({ sql: "delete from items" }));
    expect(response.status).toBe(400);
    expect((await body(response))["code"]).toBe("invalid_sql");
  });

  it("answers 400 query_failed when the statement does not run", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const response = await handler(event({ sql: "select * from missing_table" }));
    expect(response.status).toBe(400);
    expect((await body(response))["code"]).toBe("query_failed");
  });

  it("returns columns with pg types, JSON-safe rows and the timing", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const response = await handler(
      event({ sql: "select id, title, created_at from items", limit: 10 }),
    );
    expect(response.status).toBe(200);

    const payload = await body(response);
    expect(payload["columns"]).toEqual([
      { name: "id", pgType: "uuid" },
      { name: "title", pgType: "text" },
      { name: "created_at", pgType: "timestamptz" },
    ]);
    expect(payload["rows"]).toEqual([
      // PGlite returns timestamptz as its Postgres text form; the console shows it as-is.
      ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "one", "2026-11-06 10:00:00+00"],
    ]);
    expect(payload["rowCount"]).toBe(1);
    expect(payload["truncated"]).toBe(false);
    expect(typeof payload["elapsedMs"]).toBe("number");
  });

  it("caps rows at the requested limit and flags truncation", async () => {
    await applyStatements(db, [
      "INSERT INTO items (id, title) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'two')",
    ]);
    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const response = await handler(
      event({ sql: "select title from items order by title", limit: 1 }),
    );
    const payload = await body(response);
    expect(payload["rows"]).toEqual([["one"]]);
    expect(payload["truncated"]).toBe(true);
  });
});
