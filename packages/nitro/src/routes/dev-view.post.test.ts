import type { H3Event } from "nitro";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOGGING_CONFIG,
  NOOP_LOGGING_API,
  defineConfig,
  type FacilisConfig,
} from "@facilis/core";
import { applyStatements, createDb, runReadOnlyQuery, type FacilisDb } from "@facilis/db";

vi.mock("../runtime/bootstrap.ts", () => ({ getBootstrap: vi.fn() }));

import { getBootstrap, type BootstrapState } from "../runtime/bootstrap.ts";
import handler from "./dev-view.post.ts";

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

function state(db: FacilisDb | null, config: FacilisConfig | null = null): BootstrapState {
  return {
    db,
    config,
    warnings: [],
    startedAt: "2026-11-06T00:00:00.000Z",
    jobs: null,
    tasks: null,
    workflows: null,
    storage: null,
    logging: NOOP_LOGGING_API,
    loggingConfig: DEFAULT_LOGGING_CONFIG,
  };
}

const CONFIG = defineConfig({
  auth: {
    permissions: ["items:read"],
    roles: { user: ["items:read"] },
    defaultRole: "user",
  },
});

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("dev-view route", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createDb();
    await applyStatements(db, [
      "CREATE TABLE items (id uuid PRIMARY KEY, title text NOT NULL)",
      "INSERT INTO items (id, title) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'one')",
    ]);
    // The created view is granted to this role; without it the grant fails and the route
    // reports create_failed (the framework creates the role at boot in a real project).
    await applyStatements(db, ["CREATE ROLE facilis_app NOLOGIN NOSUPERUSER NOBYPASSRLS"]);
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
    const response = await handler(event({ name: "items_view", sql: "select 1 as n" }));
    expect(response.status).toBe(404);
    expect(await body(response)).toEqual({ code: "not_found" });
    expect(getBootstrap).not.toHaveBeenCalled();
  });

  it("answers 403 when the origin is not allowed", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const response = await handler(
      event({ name: "items_view", sql: "select 1 as n" }, "https://evil.example"),
    );
    expect(response.status).toBe(403);
  });

  it("answers 503 db_unavailable without a database", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(null));
    const response = await handler(event({ name: "items_view", sql: "select 1 as n" }));
    expect(response.status).toBe(503);
  });

  it("answers 400 invalid_body for a malformed body", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const noBody = await handler(event(undefined));
    expect(noBody.status).toBe(400);
    expect(await body(noBody)).toEqual({ code: "invalid_body" });
    const wrongType = await handler(event({ name: "x", sql: 1 }));
    expect(wrongType.status).toBe(400);
  });

  it("answers 400 invalid_name and invalid_sql", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));

    const badName = await handler(event({ name: "Bad Name", sql: "select 1 as n" }));
    expect(badName.status).toBe(400);
    expect((await body(badName))["code"]).toBe("invalid_name");

    const badSql = await handler(event({ name: "items_view", sql: "delete from items" }));
    expect(badSql.status).toBe(400);
    expect((await body(badSql))["code"]).toBe("invalid_sql");
  });

  it("creates the view so a later console query can select from it", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const response = await handler(
      event({ name: "items_view", sql: "select id, title from items" }),
    );
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ name: "items_view" });

    const rows = await runReadOnlyQuery(db, "select title from items_view");
    expect(rows.rows).toEqual([["one"]]);

    const grant = await runReadOnlyQuery(
      db,
      "select has_table_privilege('facilis_app', 'items_view', 'select') as granted",
    );
    expect(grant.rows).toEqual([[true]]);
  });

  it("answers 400 create_failed when the name is already a table", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const response = await handler(event({ name: "items", sql: "select 1 as n" }));
    expect(response.status).toBe(400);
    expect((await body(response))["code"]).toBe("create_failed");
  });

  it("answers 400 invalid_body for a non-string permission", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db, CONFIG));
    const response = await handler(
      event({ name: "items_view", sql: "select 1 as n", permission: 42 }),
    );
    expect(response.status).toBe(400);
    expect((await body(response))["code"]).toBe("invalid_body");
  });

  it("rejects a permission the project did not declare, with or without a loaded config", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db, CONFIG));
    const undeclared = await handler(
      event({ name: "items_perm_view", sql: "select id from items", permission: "stats:read" }),
    );
    expect(undeclared.status).toBe(400);
    expect((await body(undeclared))["code"]).toBe("invalid_permission");

    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const noConfig = await handler(
      event({ name: "items_perm_view", sql: "select id from items", permission: "items:read" }),
    );
    expect(noConfig.status).toBe(400);
    expect((await body(noConfig))["code"]).toBe("invalid_permission");
  });

  it("creates a definer view gated by a declared permission", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db, CONFIG));
    const response = await handler(
      event({
        name: "items_perm_view",
        sql: "select id, title from items",
        permission: "items:read",
      }),
    );
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ name: "items_perm_view" });

    const options = await runReadOnlyQuery(
      db,
      "select array_to_string(reloptions, ',') as options from pg_class where relname = 'items_perm_view'",
    );
    expect(options.rows).toEqual([["security_invoker=false"]]);

    // The permission predicate is part of the view definition; without app.permissions the
    // gate returns no rows even for the superuser (the db tests cover the allowed case).
    const definition = await runReadOnlyQuery(
      db,
      "select definition from pg_views where viewname = 'items_perm_view'",
    );
    expect(String(definition.rows[0]?.[0])).toContain("app.permissions");
    const denied = await runReadOnlyQuery(db, "select title from items_perm_view");
    expect(denied.rows).toEqual([]);

    const grant = await runReadOnlyQuery(
      db,
      "select has_table_privilege('facilis_app', 'items_perm_view', 'select') as granted",
    );
    expect(grant.rows).toEqual([[true]]);
  });
});
