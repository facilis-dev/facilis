import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithPolicyScope, type FacilisDb } from "@facilis/db";

import type { IdentityClaims, SsoAudit, SsoAuditInput, SystemRunner } from "./contracts.ts";
import { resolveIdentity, type ResolveIdentityOptions } from "./identity.ts";
import { authIdentities } from "./tables.ts";
import { roles, userRoles, users } from "../tables.ts";
import { createAuthTestDb } from "../test-support.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let db: FacilisDb;
let system: SystemRunner;
let auditEntries: SsoAuditInput[];

function audit(): SsoAudit {
  return (input) => {
    auditEntries.push(input);
  };
}

const options: ResolveIdentityOptions = { defaultRole: "user", audit: audit() };

function claims(overrides: Partial<IdentityClaims> = {}): IdentityClaims {
  return {
    provider: "corp",
    subject: "subject-1",
    email: "user@example.com",
    emailVerified: true,
    ...overrides,
  };
}

function provider(overrides: { autoProvision?: boolean; defaultRole?: string } = {}) {
  return {
    id: "corp",
    autoProvision: overrides.autoProvision ?? true,
    ...(overrides.defaultRole === undefined ? {} : { defaultRole: overrides.defaultRole }),
  };
}

async function insertUser(email: string): Promise<string> {
  const [row] = await db.db
    .insert(users)
    .values({ email, tenantId: TENANT_ID })
    .returning({ id: users.id });
  if (row === undefined) throw new Error("failed to insert user fixture");
  return row.id;
}

async function insertServiceUser(email: string): Promise<string> {
  const [row] = await db.db
    .insert(users)
    .values({ email, tenantId: TENANT_ID, passwordHash: null, isService: true })
    .returning({ id: users.id });
  if (row === undefined) throw new Error("failed to insert service user fixture");
  return row.id;
}

async function identityRow(providerId: string, subject: string) {
  const rows = await db.db
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, providerId), eq(authIdentities.subject, subject)));
  return rows[0] ?? null;
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
  await db.db.insert(roles).values([{ name: "admin" }, { name: "user" }, { name: "viewer" }]);
});

afterAll(async () => {
  await db.close();
});

describe("resolveIdentity", () => {
  it("reuses an existing identity link and refreshes the last login", async () => {
    auditEntries = [];
    const userId = await insertUser("existing@example.com");
    await db.db.insert(authIdentities).values({
      provider: "corp",
      subject: "existing",
      userId,
      email: "old@example.com",
      tenantId: TENANT_ID,
    });

    const result = await resolveIdentity(
      system,
      claims({ subject: "existing", email: "new@example.com" }),
      provider(),
      options,
    );

    expect(result).toEqual({ userId, outcome: "existing" });
    const row = await identityRow("corp", "existing");
    expect(row?.email).toBe("new@example.com");
    expect(row?.lastLoginAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    // An existing link is not "linked" again.
    expect(auditEntries.filter((entry) => entry.operation === "auth:sso:link")).toHaveLength(0);
  });

  it("keeps a link when the provider later reports an unverified email", async () => {
    const userId = await insertUser("unverified-existing@example.com");
    await db.db.insert(authIdentities).values({
      provider: "corp",
      subject: "unverified-existing",
      userId,
      email: "a@example.com",
      tenantId: TENANT_ID,
    });

    const result = await resolveIdentity(
      system,
      claims({ subject: "unverified-existing", email: "b@example.com", emailVerified: false }),
      provider(),
      options,
    );
    expect(result.userId).toBe(userId);
  });

  it("links a verified email to an existing user (case-insensitively) and audits the link", async () => {
    auditEntries = [];
    const userId = await insertUser("Mixed@Example.com");
    const result = await resolveIdentity(
      system,
      claims({ subject: "link-me", email: "mixed@example.com" }),
      provider(),
      options,
    );

    expect(result).toEqual({ userId, outcome: "linked" });
    expect((await identityRow("corp", "link-me"))?.userId).toBe(userId);
    expect(auditEntries).toContainEqual(
      expect.objectContaining({
        operation: "auth:sso:link",
        outcome: "succeeded",
        details: { provider: "corp" },
      }),
    );
  });

  it("provisions a user with a null password and the configured default role", async () => {
    auditEntries = [];
    const result = await resolveIdentity(
      system,
      claims({ subject: "provision-me", email: "provision@example.com" }),
      provider(),
      options,
    );

    expect(result.outcome).toBe("provisioned");
    const [user] = await db.db
      .select({ passwordHash: users.passwordHash, email: users.email })
      .from(users)
      .where(eq(users.id, result.userId));
    expect(user).toEqual({ passwordHash: null, email: "provision@example.com" });
    expect(await roleNames(result.userId)).toEqual(["user"]);
    expect((await identityRow("corp", "provision-me"))?.userId).toBe(result.userId);
    expect(auditEntries).toContainEqual(
      expect.objectContaining({
        operation: "auth:sso:provision",
        outcome: "succeeded",
        details: { provider: "corp", role: "user" },
      }),
    );
  });

  it("honours the provider defaultRole override", async () => {
    const result = await resolveIdentity(
      system,
      claims({ subject: "admin-provision", email: "admin-provision@example.com" }),
      provider({ defaultRole: "admin" }),
      options,
    );
    expect(await roleNames(result.userId)).toEqual(["admin"]);
  });

  it("refuses an unknown user when autoProvision is off", async () => {
    await expect(
      resolveIdentity(
        system,
        claims({ subject: "nobody", email: "nobody@example.com" }),
        provider({ autoProvision: false }),
        options,
      ),
    ).rejects.toMatchObject({ code: "sso_account_not_found" });
    expect(await identityRow("corp", "nobody")).toBeNull();
  });

  it("never links or provisions on an unverified email", async () => {
    await expect(
      resolveIdentity(
        system,
        claims({ subject: "unverified", email: "unverified@example.com", emailVerified: false }),
        provider(),
        options,
      ),
    ).rejects.toMatchObject({ code: "sso_email_unverified" });
    expect(await identityRow("corp", "unverified")).toBeNull();
  });

  it("refuses an existing identity link that points at a service account", async () => {
    const serviceUserId = await insertServiceUser("service-linked@example.com");
    await db.db.insert(authIdentities).values({
      provider: "corp",
      subject: "service-linked",
      userId: serviceUserId,
      email: "service-linked@example.com",
      tenantId: TENANT_ID,
    });

    await expect(
      resolveIdentity(
        system,
        claims({ subject: "service-linked", email: "service-linked@example.com" }),
        provider(),
        options,
      ),
    ).rejects.toMatchObject({ code: "sso_account_not_found" });
  });

  it("never links a verified email that belongs to a service account", async () => {
    await insertServiceUser("service-email@example.com");

    await expect(
      resolveIdentity(
        system,
        claims({ subject: "service-email", email: "service-email@example.com" }),
        provider(),
        options,
      ),
    ).rejects.toMatchObject({ code: "sso_account_not_found" });
    expect(await identityRow("corp", "service-email")).toBeNull();
  });

  it("keeps audit entries free of the email address", () => {
    const serialized = JSON.stringify(auditEntries);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("password");
  });
});
