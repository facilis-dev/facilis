import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb } from "@facilis/db";

import type { IdentityClaims, SsoAudit, SsoAuditInput, SystemRunner } from "./contracts.ts";
import { resolveIdentity, type ResolveIdentityOptions } from "./identity.ts";
import { authIdentities } from "./tables.ts";
import { roles, userRoles, users } from "../tables.ts";
import { createAuthTestDb } from "../test-support.ts";

/**
 * Account claiming and linking against email verification (SEC-02, D-156), split from
 * identity.test.ts to keep each test module under the repository's 300-line limit.
 */
const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let db: FacilisDb;
let system: SystemRunner;
let auditEntries: SsoAuditInput[];

const audit: SsoAudit = (input) => {
  auditEntries.push(input);
};

const options: ResolveIdentityOptions = {
  defaultRole: "user",
  claimUnverifiedPasswordAccount: true,
  audit,
};

function claims(overrides: Partial<IdentityClaims> = {}): IdentityClaims {
  return {
    provider: "corp",
    subject: "subject-1",
    email: "user@example.com",
    emailVerified: true,
    ...overrides,
  };
}

function provider() {
  return { id: "corp", autoProvision: true };
}

async function insertPasswordUser(
  email: string,
  settings: { readonly verified?: boolean } = {},
): Promise<string> {
  const [row] = await db.db
    .insert(users)
    .values({
      email,
      tenantId: TENANT_ID,
      // Any non-null hash marks a password account; the SSO guard never verifies it.
      passwordHash: "pbkdf2-sha256$600000$c2FsdA==$aGFzaA==",
      emailVerifiedAt: settings.verified === true ? new Date() : null,
    })
    .returning({ id: users.id });
  if (row === undefined) throw new Error("failed to insert password user fixture");
  return row.id;
}

async function userRow(userId: string) {
  const rows = await db.db
    .select({
      email: users.email,
      passwordHash: users.passwordHash,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0] ?? null;
}

async function identityRow(providerId: string, subject: string) {
  const rows = await db.db.select().from(authIdentities).where(eq(authIdentities.subject, subject));
  return rows.find((row) => row.provider === providerId) ?? null;
}

async function roleNames(userId: string): Promise<string[]> {
  const rows = await db.db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return rows.map((row) => row.role);
}

beforeAll(async () => {
  db = await createAuthTestDb();
  system = (_options, fn) => runWithPolicyScope(db, { tenantId: TENANT_ID }, fn);
  await db.db.insert(roles).values([{ name: "admin" }, { name: "user" }]);
});

afterAll(async () => {
  await db.close();
});

describe("resolveIdentity account claiming (SEC-02, D-156)", () => {
  it("claims an unverified password account, clearing the placeholder password", async () => {
    auditEntries = [];
    const userId = await insertPasswordUser("Victim@Example.com");

    const result = await resolveIdentity(
      system,
      claims({ subject: "pre-hijack", email: "victim@example.com" }),
      provider(),
      options,
    );

    expect(result).toEqual({ userId, outcome: "linked" });
    expect(await identityRow("corp", "pre-hijack")).not.toBeNull();
    const row = await userRow(userId);
    // The mailbox is proven by the IdP: the account is verified and the stale password — set by
    // whoever registered the address first — is gone.
    expect(row?.passwordHash).toBeNull();
    expect(row?.emailVerifiedAt).not.toBeNull();
    expect(await roleNames(userId)).toEqual([]);
    expect(auditEntries).toContainEqual(
      expect.objectContaining({
        operation: "auth:sso:link",
        outcome: "succeeded",
        details: { provider: "corp", claimed: "unverified_password" },
      }),
    );
  });

  it("refuses the link when email verification is disabled (password kept)", async () => {
    const userId = await insertPasswordUser("pending-no-verification@example.com");

    await expect(
      resolveIdentity(
        system,
        claims({
          subject: "pending-no-verification",
          email: "pending-no-verification@example.com",
        }),
        provider(),
        { ...options, claimUnverifiedPasswordAccount: false },
      ),
    ).rejects.toMatchObject({ code: "sso_email_conflict" });
    expect(await identityRow("corp", "pending-no-verification")).toBeNull();
    // The feature is off: the account keeps the password its owner registered.
    expect((await userRow(userId))?.passwordHash).not.toBeNull();
  });

  it("links a VERIFIED password account without clearing its password", async () => {
    const userId = await insertPasswordUser("verified-owner@example.com", { verified: true });
    const result = await resolveIdentity(
      system,
      claims({ subject: "verified-password-link", email: "verified-owner@example.com" }),
      provider(),
      options,
    );

    expect(result).toEqual({ userId, outcome: "linked" });
    expect(await identityRow("corp", "verified-password-link")).not.toBeNull();
    // The owner already proved the mailbox: the password stays valid alongside SSO.
    expect((await userRow(userId))?.passwordHash).not.toBeNull();
  });

  it("still never links or provisions on an unverified email claim", async () => {
    await expect(
      resolveIdentity(
        system,
        claims({ subject: "unverified-claim", email: "nobody@example.com", emailVerified: false }),
        provider(),
        options,
      ),
    ).rejects.toMatchObject({ code: "sso_email_unverified" });
    expect(await identityRow("corp", "unverified-claim")).toBeNull();
  });
});
