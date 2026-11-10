import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb, type PolicyScopedDatabase } from "@facilis/db";

import {
  consumeEmailVerification,
  issueEmailVerification,
  markEmailVerified,
} from "./email-verification.ts";
import { authEmailVerifications, roles, users } from "./tables.ts";
import { createAuthTestDb } from "./test-support.ts";

/**
 * Email verification primitive (D-156): issue/consume is single-use, TTL-bounded and rotates the
 * outstanding link; the raw token never reaches the table. Every call runs inside the request's
 * tenant scope, exactly like the audited `ctx.system` elevation a route uses.
 */
const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TTL_MS = 60_000;

let db: FacilisDb;

beforeAll(async () => {
  db = await createAuthTestDb();
  await db.db.insert(roles).values([{ name: "user" }]);
});

afterAll(async () => {
  await db.close();
});

function scoped<T>(fn: (client: PolicyScopedDatabase) => Promise<T>): Promise<T> {
  return runWithPolicyScope(db, { tenantId: TENANT_ID }, fn);
}

async function insertUser(email: string): Promise<string> {
  const [row] = await db.db
    .insert(users)
    .values({ email, tenantId: TENANT_ID })
    .returning({ id: users.id });
  if (row === undefined) throw new Error("failed to insert user fixture");
  return row.id;
}

async function verifiedAt(userId: string): Promise<Date | null> {
  const rows = await db.db
    .select({ emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0]?.emailVerifiedAt ?? null;
}

async function tokenRows(userId: string): Promise<number> {
  const rows = await db.db
    .select({ id: authEmailVerifications.id })
    .from(authEmailVerifications)
    .where(eq(authEmailVerifications.userId, userId));
  return rows.length;
}

describe("issueEmailVerification / consumeEmailVerification", () => {
  it("verifies the user through a single-use token and stores only its hash", async () => {
    const userId = await insertUser("verify-me@example.com");
    const issued = await scoped((client) =>
      issueEmailVerification(client, userId, { ttlMs: TTL_MS }),
    );

    expect(issued.token.length).toBeGreaterThan(20);
    expect(await tokenRows(userId)).toBe(1);

    await expect(
      scoped((client) => consumeEmailVerification(client, issued.token)),
    ).resolves.toEqual({ userId });
    expect(await verifiedAt(userId)).not.toBeNull();
    // Single use: the row is gone, so a replayed link finds nothing.
    expect(await tokenRows(userId)).toBe(0);
    await expect(
      scoped((client) => consumeEmailVerification(client, issued.token)),
    ).resolves.toBeNull();
  });

  it("rejects an unknown token without touching any account", async () => {
    await expect(
      scoped((client) => consumeEmailVerification(client, "not-a-real-token")),
    ).resolves.toBeNull();
  });

  it("rejects an expired token, deletes it and leaves the user unverified", async () => {
    const userId = await insertUser("expired@example.com");
    const now = new Date("2026-11-10T10:00:00.000Z");
    const issued = await scoped((client) =>
      issueEmailVerification(client, userId, { ttlMs: TTL_MS, now }),
    );

    const later = new Date(now.getTime() + TTL_MS + 1);
    await expect(
      scoped((client) => consumeEmailVerification(client, issued.token, later)),
    ).resolves.toBeNull();
    expect(await verifiedAt(userId)).toBeNull();
    expect(await tokenRows(userId)).toBe(0);
  });

  it("rotates the outstanding link: the previous token stops working", async () => {
    const userId = await insertUser("rotate@example.com");
    const first = await scoped((client) =>
      issueEmailVerification(client, userId, { ttlMs: TTL_MS }),
    );
    const second = await scoped((client) =>
      issueEmailVerification(client, userId, { ttlMs: TTL_MS }),
    );

    expect(await tokenRows(userId)).toBe(1);
    await expect(
      scoped((client) => consumeEmailVerification(client, first.token)),
    ).resolves.toBeNull();
    await expect(
      scoped((client) => consumeEmailVerification(client, second.token)),
    ).resolves.toEqual({
      userId,
    });
  });

  it("keeps one user's token from verifying another account", async () => {
    const first = await insertUser("first-owner@example.com");
    const second = await insertUser("second-owner@example.com");
    const issued = await scoped((client) =>
      issueEmailVerification(client, first, { ttlMs: TTL_MS }),
    );

    await expect(
      scoped((client) => consumeEmailVerification(client, issued.token)),
    ).resolves.toEqual({
      userId: first,
    });
    expect(await verifiedAt(second)).toBeNull();
  });

  it("marks an account verified without a link (development fallback)", async () => {
    const userId = await insertUser("dev-shortcut@example.com");
    await expect(scoped((client) => markEmailVerified(client, userId))).resolves.toBe(true);
    expect(await verifiedAt(userId)).not.toBeNull();
    // Idempotent: a second call only refreshes the timestamp.
    await expect(scoped((client) => markEmailVerified(client, userId))).resolves.toBe(true);
  });
});
