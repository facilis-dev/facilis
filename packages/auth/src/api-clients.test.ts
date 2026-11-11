import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensureSystemRole,
  runWithPolicyScope,
  runWithSystemRole,
  type FacilisDb,
} from "@facilis.dev/db";

import {
  createApiClient,
  issueApiToken,
  listApiClients,
  revokeApiClient,
  validateApiToken,
  type CreatedApiClient,
  type IssuedApiToken,
} from "./api-clients.ts";
import { sha256Hex } from "./crypto.ts";
import { apiClients, apiTokens, roles, userRoles, users } from "./tables.ts";
import { createAuthTestDb } from "./test-support.ts";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SUDO_ID = "test-api-client-sudo";

let db: FacilisDb;

/**
 * Creates a client the way a route does: inside the deployment tenant scope, under the
 * audited system identity the `roles` table requires (D-136).
 */
async function createClient(name: string, role: string): Promise<CreatedApiClient> {
  return runWithPolicyScope(db, { tenantId: TENANT_ID }, (tx) =>
    runWithSystemRole(tx, { sudoId: SUDO_ID }, (systemDb) =>
      createApiClient(systemDb, { name, role }),
    ),
  );
}

async function issueToken(client: CreatedApiClient, ttlMs = 60_000): Promise<IssuedApiToken> {
  const issued = await issueApiToken(db.db, {
    clientId: client.clientId,
    clientSecret: client.secret,
    ttlMs,
  });
  if (issued === null) throw new Error("expected the fixture token to be issued");
  return issued;
}

async function storedClient(id: string) {
  const rows = await db.db.select().from(apiClients).where(eq(apiClients.id, id));
  const row = rows[0];
  if (row === undefined) throw new Error("expected the fixture client row");
  return row;
}

async function storedToken(accessToken: string) {
  const rows = await db.db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, await sha256Hex(accessToken)));
  const row = rows[0];
  if (row === undefined) throw new Error("expected the fixture token row");
  return row;
}

beforeAll(async () => {
  db = await createAuthTestDb();
  await ensureSystemRole(db);
  await db.db.insert(roles).values([{ name: "admin" }, { name: "viewer" }]);
}, 30_000);

afterAll(async () => {
  await db.close();
});

describe("createApiClient", () => {
  it("creates a service user and stores only hashed credentials", async () => {
    const created = await createClient("CI runner", "admin");

    expect(created.clientId).toMatch(/^fcli_[A-Za-z0-9_-]{20,}$/);
    expect(created.secret).toMatch(/^fsec_[A-Za-z0-9_-]{20,}$/);
    expect(created).toMatchObject({ name: "CI runner", role: "admin" });

    const userRows = await db.db.select().from(users).where(eq(users.id, created.userId));
    const user = userRows[0];
    if (user === undefined) throw new Error("expected the service user row");
    expect(user.isService).toBe(true);
    expect(user.passwordHash).toBeNull();
    expect(user.email).toMatch(/^service\+[0-9a-f-]{36}@facilis\.invalid$/);

    const roleRows = await db.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, created.userId));
    expect(roleRows).toEqual([{ role: "admin" }]);

    const client = await storedClient(created.id);
    expect(client.secretHash).toBe(await sha256Hex(created.secret));
    expect(client.secretHash).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext secret lives only in the return value: it is nowhere in the stored row.
    expect(JSON.stringify(client)).not.toContain(created.secret);
    expect(client.lastUsedAt).toBeNull();
    expect(client.revokedAt).toBeNull();
  });

  it("rejects a role the project never declared", async () => {
    await expect(createClient("rogue", "root")).rejects.toThrow(/unknown role "root"/);
  });

  it("lists clients without the secret hash", async () => {
    const created = await createClient("list-me", "viewer");

    const listed = await listApiClients(db.db);
    const entry = listed.find((client) => client.id === created.id);
    expect(entry).toMatchObject({
      clientId: created.clientId,
      name: "list-me",
      role: "viewer",
      userId: created.userId,
      revokedAt: null,
    });
    expect(entry?.createdAt).toBeInstanceOf(Date);
    expect(entry).not.toHaveProperty("secretHash");
  });
});

describe("issueApiToken", () => {
  it("issues a token for the right secret and stores only its hash", async () => {
    const created = await createClient("issuer", "admin");
    const issued = await issueToken(created);

    expect(issued.accessToken).toMatch(/^fat_[A-Za-z0-9_-]{20,}$/);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const token = await storedToken(issued.accessToken);
    expect(JSON.stringify(token)).not.toContain(issued.accessToken);
    expect(token.userId).toBe(created.userId);
    expect(token.expiresAt.getTime()).toBe(issued.expiresAt.getTime());

    // Issuing counts as a use of the client.
    expect((await storedClient(created.id)).lastUsedAt).toBeInstanceOf(Date);
  });

  it("returns null for a wrong secret or an unknown client", async () => {
    const created = await createClient("guard", "admin");

    await expect(
      issueApiToken(db.db, {
        clientId: created.clientId,
        clientSecret: created.secret + "x",
        ttlMs: 60_000,
      }),
    ).resolves.toBeNull();
    await expect(
      issueApiToken(db.db, {
        clientId: "fcli_missing",
        clientSecret: created.secret,
        ttlMs: 60_000,
      }),
    ).resolves.toBeNull();
  });

  it("returns null for a revoked client", async () => {
    const created = await createClient("revoked-issuer", "admin");
    await revokeApiClient(db.db, created.id);

    await expect(
      issueApiToken(db.db, {
        clientId: created.clientId,
        clientSecret: created.secret,
        ttlMs: 60_000,
      }),
    ).resolves.toBeNull();
  });
});

describe("validateApiToken", () => {
  it("returns the service user, the client role and the token hash", async () => {
    const created = await createClient("validator", "admin");
    const issued = await issueToken(created);

    await expect(validateApiToken(db.db, issued.accessToken)).resolves.toEqual({
      userId: created.userId,
      role: "admin",
      tokenHash: await sha256Hex(issued.accessToken),
    });
  });

  it("returns each client's own fixed role", async () => {
    const admin = await createClient("role-admin", "admin");
    const viewer = await createClient("role-viewer", "viewer");

    const adminToken = await issueToken(admin);
    const viewerToken = await issueToken(viewer);

    expect((await validateApiToken(db.db, adminToken.accessToken))?.role).toBe("admin");
    expect((await validateApiToken(db.db, viewerToken.accessToken))?.role).toBe("viewer");
  });

  it("rejects an expired token", async () => {
    const created = await createClient("expiry", "admin");
    const issued = await issueToken(created, -1);

    await expect(validateApiToken(db.db, issued.accessToken)).resolves.toBeNull();
  });

  it("rejects an unknown token and rewrites last_used_at at most once per window", async () => {
    const created = await createClient("touch-once", "admin");
    const issued = await issueToken(created);

    await expect(validateApiToken(db.db, "fat_not-a-real-token")).resolves.toBeNull();

    await validateApiToken(db.db, issued.accessToken);
    const first = (await storedToken(issued.accessToken)).lastUsedAt;
    await validateApiToken(db.db, issued.accessToken);
    const second = (await storedToken(issued.accessToken)).lastUsedAt;

    expect(first).toBeInstanceOf(Date);
    expect(second?.getTime()).toBe(first?.getTime());
  });
});

describe("revokeApiClient", () => {
  it("revokes the client and every token it issued", async () => {
    const created = await createClient("revoked", "admin");
    const issued = await issueToken(created);

    await expect(revokeApiClient(db.db, created.id)).resolves.toBe(true);

    const client = await storedClient(created.id);
    expect(client.revokedAt).toBeInstanceOf(Date);
    expect((await storedToken(issued.accessToken)).revokedAt).toBeInstanceOf(Date);
    // A revoked token no longer authenticates and the client no longer issues.
    await expect(validateApiToken(db.db, issued.accessToken)).resolves.toBeNull();
    await expect(
      issueApiToken(db.db, {
        clientId: created.clientId,
        clientSecret: created.secret,
        ttlMs: 60_000,
      }),
    ).resolves.toBeNull();

    // Idempotent: a second revoke keeps the original audit timestamp.
    await expect(revokeApiClient(db.db, created.id)).resolves.toBe(true);
    expect((await storedClient(created.id)).revokedAt?.getTime()).toBe(client.revokedAt?.getTime());
  });

  it("returns false for an unknown client id", async () => {
    await expect(revokeApiClient(db.db, "00000000-0000-0000-0000-000000000000")).resolves.toBe(
      false,
    );
  });
});
