import type { H3Event } from "nitro";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyStatements, createDb, type FacilisDb } from "@facilis/db";

vi.mock("../runtime/bootstrap.ts", () => ({ getBootstrap: vi.fn() }));

import { getBootstrap, type BootstrapState } from "../runtime/bootstrap.ts";
import handler from "./dev-schema.get.ts";

const ORIGINAL_ENV = process.env.NODE_ENV;

function event(origin?: string): H3Event {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return { req: { headers } } as unknown as H3Event;
}

function state(db: FacilisDb | null, warnings: BootstrapState["warnings"] = []): BootstrapState {
  return {
    db,
    config: null,
    warnings,
    startedAt: "2026-11-02T00:00:00.000Z",
    jobs: null,
    storage: null,
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("dev-schema route", () => {
  let db: FacilisDb;

  beforeAll(async () => {
    db = await createDb();
    await applyStatements(db, [
      "CREATE TABLE items (id uuid PRIMARY KEY, title text NOT NULL)",
      "ALTER TABLE items ENABLE ROW LEVEL SECURITY",
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
    const response = await handler(event());
    expect(response.status).toBe(404);
    expect(await body(response)).toEqual({ code: "not_found" });
    expect(getBootstrap).not.toHaveBeenCalled();
  });

  it("answers 403 when the origin is not allowed", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(db));
    const response = await handler(event("https://evil.example"));
    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ code: "forbidden" });
  });

  it("answers 503 db_unavailable when the runtime has no database", async () => {
    vi.mocked(getBootstrap).mockResolvedValue(state(null));
    const response = await handler(event());
    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({ code: "db_unavailable" });
  });

  it("returns the code snapshot, the live snapshot and the typed drift", async () => {
    const warnings = [{ code: "config_invalid", message: "config broken" }];
    vi.mocked(getBootstrap).mockResolvedValue(state(db, warnings));
    const response = await handler(event());
    expect(response.status).toBe(200);

    const payload = await body(response);
    expect(payload["code"]).toEqual({ tables: [] });
    expect(payload["warnings"]).toEqual(warnings);
    const live = payload["live"] as { tables: { name: string; rlsEnabled: boolean }[] };
    expect(live.tables.map((table) => table.name)).toEqual(["items"]);
    expect(live.tables[0]?.rlsEnabled).toBe(true);
    expect(payload["drift"]).toEqual([{ kind: "table_extra", table: "items" }]);
  });
});
