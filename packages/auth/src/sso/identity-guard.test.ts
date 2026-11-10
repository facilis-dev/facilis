import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb } from "@facilis/db";

import type { IdentityClaims, SsoAudit, SystemRunner } from "./contracts.ts";
import { resolveIdentity, type ResolveIdentityOptions } from "./identity.ts";
import { authIdentities } from "./tables.ts";
import { roles, userRoles, users } from "../tables.ts";
import { createAuthTestDb } from "../test-support.ts";

/**
 * Account-linking guard (SEC-02, D-151) and canonical email identity (D-150), split from
 * identity.test.ts to keep each test module under the repository's 300-line limit.
 */
const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let db: FacilisDb;
let system: SystemRunner;

const audit: SsoAudit = () => {};

const options: ResolveIdentityOptions = {
  defaultRole: "user",
  linkPasswordAccounts: false,
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

async function insertPasswordUser(email: string): Promise<string> {
  const [row] = await db.db
    .insert(users)
    .values({
      email,
      tenantId: TENANT_ID,
      // Any non-null hash marks a password account; the SSO guard never verifies it.
      passwordHash: "pbkdf2-sha256$600000$c2FsdA==$aGFzaA==",
    })
    .returning({ id: users.id });
  if (row === undefined) throw new Error("failed to insert password user fixture");
  return row.id;
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

describe("resolveIdentity account linking (SEC-02)", () => {
  it("refuses to link a verified email to a password account by default (SEC-02)", async () => {
    const userId = await insertPasswordUser("Victim@Example.com");

    await expect(
      resolveIdentity(
        system,
        claims({ subject: "pre-hijack", email: "victim@example.com" }),
        provider(),
        options,
      ),
    ).rejects.toMatchObject({ code: "sso_email_conflict" });
    expect(await identityRow("corp", "pre-hijack")).toBeNull();
    // The account is untouched: no identity row, no audit claiming a link.
    expect(await roleNames(userId)).toEqual([]);
  });

  it("links a verified email to a password account only with the explicit opt-in (D-151)", async () => {
    const userId = await insertPasswordUser("opt-in@example.com");
    const result = await resolveIdentity(
      system,
      claims({ subject: "opt-in-link", email: "opt-in@example.com" }),
      provider(),
      { ...options, linkPasswordAccounts: true },
    );

    expect(result).toEqual({ userId, outcome: "linked" });
    expect((await identityRow("corp", "opt-in-link"))?.userId).toBe(userId);
  });

  it("stores provisioned emails in canonical form (D-150)", async () => {
    const result = await resolveIdentity(
      system,
      claims({ subject: "provision-case", email: "Case.Provisioned@Example.COM" }),
      provider(),
      options,
    );

    const [user] = await db.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, result.userId));
    expect(user).toEqual({ email: "case.provisioned@example.com" });
    expect((await identityRow("corp", "provision-case"))?.email).toBe(
      "case.provisioned@example.com",
    );
  });
});
