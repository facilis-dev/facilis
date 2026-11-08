import { describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb } from "@facilis/db";

import type { SystemRunner } from "./contracts.ts";
import { createAuthTestDb } from "../test-support.ts";
import { authSsoStates } from "./tables.ts";
import { consumeSsoState, createSsoState, MAX_REDIRECT_TO, normalizeRedirectTo } from "./state.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function systemFor(db: FacilisDb): SystemRunner {
  return (_options, fn) => runWithPolicyScope(db, { tenantId: TENANT_ID }, fn);
}

async function rowCount(db: FacilisDb): Promise<number> {
  const rows = await db.db.select().from(authSsoStates);
  return rows.length;
}

describe("normalizeRedirectTo", () => {
  it("accepts same-origin absolute paths", () => {
    expect(normalizeRedirectTo("/todos")).toBe("/todos");
    expect(normalizeRedirectTo("/preview/5173/todos?x=1")).toBe("/preview/5173/todos?x=1");
  });

  it("rejects absolute URLs, protocol-relative paths, backslashes and control characters", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/to dos",
      "/todos\n",
      "todos",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(normalizeRedirectTo(value)).toBeNull();
    }
  });

  it("rejects a path longer than the contract cap", () => {
    expect(normalizeRedirectTo("/" + "a".repeat(MAX_REDIRECT_TO))).toBeNull();
    expect(normalizeRedirectTo("/" + "a".repeat(MAX_REDIRECT_TO - 1))).not.toBeNull();
  });
});

describe("SsoState lifecycle", () => {
  it("creates a single-use row with the requested lifetime", async () => {
    const db = await createAuthTestDb();
    try {
      const system = systemFor(db);
      const now = Date.now();
      const row = await createSsoState(
        system,
        { provider: "corp", ttlMs: 60_000, redirectTo: "/todos", nonce: "n", codeVerifier: "v" },
        now,
      );

      expect(row.state).toMatch(/^[A-Za-z0-9_-]{40,45}$/);
      expect(row.redirectTo).toBe("/todos");
      expect(row.nonce).toBe("n");
      expect(row.expiresAt.getTime()).toBe(now + 60_000);

      const consumed = await consumeSsoState(system, row.state, now + 1);
      expect(consumed.state).toBe(row.state);
      // Second use: the row is gone.
      await expect(consumeSsoState(system, row.state, now + 2)).rejects.toMatchObject({
        code: "sso_state_invalid",
      });
    } finally {
      await db.close();
    }
  });

  it("rejects an expired row and removes it", async () => {
    const db = await createAuthTestDb();
    try {
      const system = systemFor(db);
      const now = Date.now();
      const row = await createSsoState(
        system,
        { provider: "corp", ttlMs: 1_000, redirectTo: null },
        now,
      );
      await expect(consumeSsoState(system, row.state, now + 1_001)).rejects.toMatchObject({
        code: "sso_state_invalid",
      });
      expect(await rowCount(db)).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("prunes expired rows when a new attempt starts", async () => {
    const db = await createAuthTestDb();
    try {
      const system = systemFor(db);
      const now = Date.now();
      await createSsoState(system, { provider: "old", ttlMs: 1_000, redirectTo: null }, now);
      await createSsoState(
        system,
        { provider: "new", ttlMs: 60_000, redirectTo: null },
        now + 5_000,
      );
      expect(await rowCount(db)).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("refuses a malformed state value before touching the database", async () => {
    const db = await createAuthTestDb();
    try {
      await expect(consumeSsoState(systemFor(db), "short")).rejects.toMatchObject({
        code: "sso_state_invalid",
      });
    } finally {
      await db.close();
    }
  });

  it("creates the state with an explicit token for SAML RelayState", async () => {
    const db = await createAuthTestDb();
    try {
      const row = await createSsoState(systemFor(db), {
        state: "fixed-state-token-1234567890",
        provider: "acme",
        ttlMs: 60_000,
        redirectTo: "/todos",
        requestId: "_request-1",
      });
      expect(row.state).toBe("fixed-state-token-1234567890");
      expect(row.requestId).toBe("_request-1");
    } finally {
      await db.close();
    }
  });
});
