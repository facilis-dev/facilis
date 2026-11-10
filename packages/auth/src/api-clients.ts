import { and, eq, isNull, lt, or } from "drizzle-orm";

import type { PolicyScopedDatabase } from "@facilis/db";

import { constantTimeEqual, randomToken, sha256Hex } from "./crypto.ts";
import { apiClients, apiTokens, roles, userRoles, users } from "./tables.ts";

/**
 * Programmatic API clients (V3a): a service user plus a hashed secret, and short-lived
 * bearer tokens derived from it.
 *
 * Nothing secret is ever stored in the clear: the client secret and every access token are
 * written as SHA-256 hex digests, and the plaintext appears only in the return value of the
 * call that creates it (a one-time secret, like a password reset). Secrets are compared
 * through `constantTimeEqual` so verification does not leak the first mismatching byte.
 */

/** Public credential prefixes: a leaked value is recognisable to secret scanners. */
const CLIENT_ID_PREFIX = "fcli_";
const CLIENT_SECRET_PREFIX = "fsec_";
const ACCESS_TOKEN_PREFIX = "fat_";

const CLIENT_ID_BYTES = 24;
const CLIENT_SECRET_BYTES = 32;
const ACCESS_TOKEN_BYTES = 32;

/**
 * A successful validation stamps `last_used_at` at most once per window instead of on every
 * request: the column is for operators ("is this client still used?"), not an access log.
 */
const LAST_USED_WRITE_WINDOW_MS = 5 * 60 * 1000;

export interface CreateApiClientInput {
  readonly name: string;
  readonly role: string;
  /** Interactive user who created the client, when the caller knows it. */
  readonly createdBy?: string | null;
}

export interface CreatedApiClient {
  readonly id: string;
  readonly clientId: string;
  /** One-time plaintext secret: never persisted and not recoverable afterwards. */
  readonly secret: string;
  readonly name: string;
  readonly role: string;
  readonly userId: string;
}

/** Management projection of a client: same columns minus `secretHash`, which never leaves. */
export interface ApiClientSummary {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly role: string;
  readonly createdAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly userId: string;
}

export interface IssueApiTokenInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly ttlMs: number;
}

export interface IssuedApiToken {
  readonly accessToken: string;
  readonly expiresAt: Date;
}

export interface ValidatedApiToken {
  readonly userId: string;
  /** The client's fixed role, not the service user's (empty) interactive roles. */
  readonly role: string;
  /** SHA-256 of the raw token: the audit correlation value, safe to log. */
  readonly tokenHash: string;
}

/**
 * Creates a service user, its role assignment and an API client.
 *
 * Callers run this under the audited system identity: the `roles` table is system-only
 * (D-136) and here it is the migration-time projection of `config.auth.roles`
 * (`seedFromConfig`), so a role the project never declared is rejected before any row is
 * written. The service user takes its tenant from the policy-scope GUC, exactly like a
 * registration insert (D-040).
 */
export async function createApiClient(
  db: PolicyScopedDatabase,
  input: CreateApiClientInput,
): Promise<CreatedApiClient> {
  const knownRole = await db
    .select({ name: roles.name })
    .from(roles)
    .where(eq(roles.name, input.role))
    .limit(1);
  if (knownRole.length === 0) throw new Error(`createApiClient: unknown role "${input.role}"`);

  const createdUser = await db
    .insert(users)
    .values({
      email: `service+${globalThis.crypto.randomUUID()}@facilis.invalid`,
      passwordHash: null,
      isService: true,
    })
    .returning({ id: users.id });
  const user = createdUser[0];
  if (user === undefined) throw new Error("createApiClient: service user insert returned no row");

  await db.insert(userRoles).values({
    userId: user.id,
    role: input.role,
    assignedBy: input.createdBy ?? null,
  });

  const clientId = `${CLIENT_ID_PREFIX}${randomToken(CLIENT_ID_BYTES)}`;
  const secret = `${CLIENT_SECRET_PREFIX}${randomToken(CLIENT_SECRET_BYTES)}`;
  const createdClient = await db
    .insert(apiClients)
    .values({
      clientId,
      secretHash: await sha256Hex(secret),
      name: input.name,
      role: input.role,
      userId: user.id,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: apiClients.id });
  const client = createdClient[0];
  if (client === undefined) throw new Error("createApiClient: api client insert returned no row");

  return { id: client.id, clientId, secret, name: input.name, role: input.role, userId: user.id };
}

/** Lists clients for management; the secret hash is never part of the projection. */
export async function listApiClients(db: PolicyScopedDatabase): Promise<ApiClientSummary[]> {
  return db
    .select({
      id: apiClients.id,
      clientId: apiClients.clientId,
      name: apiClients.name,
      role: apiClients.role,
      createdAt: apiClients.createdAt,
      revokedAt: apiClients.revokedAt,
      lastUsedAt: apiClients.lastUsedAt,
      userId: apiClients.userId,
    })
    .from(apiClients);
}

/**
 * Revokes a client and every token issued to it. Returns false for an unknown id; revoking
 * twice is a no-op that keeps the first revocation timestamp (it is an audit fact).
 */
export async function revokeApiClient(db: PolicyScopedDatabase, id: string): Promise<boolean> {
  const found = await db
    .select({ id: apiClients.id })
    .from(apiClients)
    .where(eq(apiClients.id, id))
    .limit(1);
  if (found.length === 0) return false;

  const now = new Date();
  await db
    .update(apiClients)
    .set({ revokedAt: now })
    .where(and(eq(apiClients.id, id), isNull(apiClients.revokedAt)));
  await db
    .update(apiTokens)
    .set({ revokedAt: now })
    .where(and(eq(apiTokens.clientId, id), isNull(apiTokens.revokedAt)));
  return true;
}

/**
 * Exchanges a client id + secret for a bearer token. Returns null for an unknown client, a
 * wrong secret or a revoked client: the caller cannot tell which one failed.
 */
export async function issueApiToken(
  db: PolicyScopedDatabase,
  input: IssueApiTokenInput,
): Promise<IssuedApiToken | null> {
  const clients = await db
    .select({
      id: apiClients.id,
      userId: apiClients.userId,
      secretHash: apiClients.secretHash,
      revokedAt: apiClients.revokedAt,
    })
    .from(apiClients)
    .where(eq(apiClients.clientId, input.clientId))
    .limit(1);
  const client = clients[0];
  if (client === undefined) return null;
  if (client.revokedAt !== null) return null;

  const presentedHash = await sha256Hex(input.clientSecret);
  if (!hashesEqual(presentedHash, client.secretHash)) return null;

  const accessToken = `${ACCESS_TOKEN_PREFIX}${randomToken(ACCESS_TOKEN_BYTES)}`;
  const expiresAt = new Date(Date.now() + input.ttlMs);
  await db.insert(apiTokens).values({
    tokenHash: await sha256Hex(accessToken),
    clientId: client.id,
    userId: client.userId,
    expiresAt,
  });
  await db.update(apiClients).set({ lastUsedAt: new Date() }).where(eq(apiClients.id, client.id));
  return { accessToken, expiresAt };
}

/**
 * Validates a raw bearer token: revoked/expired tokens and tokens of a revoked client are
 * rejected. Refreshing `last_used_at` is a conditional UPDATE, so a burst of requests does
 * not turn into a burst of writes or race on the same row.
 */
export async function validateApiToken(
  db: PolicyScopedDatabase,
  rawToken: string,
): Promise<ValidatedApiToken | null> {
  const tokenHash = await sha256Hex(rawToken);
  const rows = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      role: apiClients.role,
      clientRevokedAt: apiClients.revokedAt,
    })
    .from(apiTokens)
    .innerJoin(apiClients, eq(apiTokens.clientId, apiClients.id))
    .where(eq(apiTokens.tokenHash, tokenHash))
    .limit(1);

  const found = rows[0];
  if (found === undefined) return null;
  if (found.revokedAt !== null || found.clientRevokedAt !== null) return null;
  if (found.expiresAt.getTime() <= Date.now()) return null;

  const now = new Date();
  const staleBefore = new Date(now.getTime() - LAST_USED_WRITE_WINDOW_MS);
  await db
    .update(apiTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiTokens.id, found.id),
        or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, staleBefore)),
      ),
    );

  return { userId: found.userId, role: found.role, tokenHash };
}

/** Constant-time comparison of two hex digests (both fixed-length SHA-256 output). */
function hashesEqual(left: string, right: string): boolean {
  return constantTimeEqual(new TextEncoder().encode(left), new TextEncoder().encode(right));
}
