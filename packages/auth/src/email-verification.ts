import { eq } from "drizzle-orm";

import type { PolicyScopedDatabase } from "@facilis.dev/db";

import { randomToken, sha256Hex } from "./crypto.ts";
import { authEmailVerifications, users } from "./tables.ts";

/**
 * Email verification for password accounts (D-156).
 *
 * The primitive is split from delivery on purpose: `@facilis.dev/auth` owns the single-use token and
 * the `users.email_verified_at` transition, while the project (or the blueprint) owns how the
 * link reaches the mailbox. Every call runs inside the caller's audited `ctx.system` elevation,
 * because the verification route is reached before a session exists (same D-099 shape as
 * registration).
 *
 * Tokens are stored as `sha256(token)`: a tenant-scoped read of the table yields no usable link,
 * exactly like sessions (D-144) and SSO state (D-120).
 */

export const EMAIL_VERIFICATION_TABLES = ["auth_email_verifications", "users"] as const;

export interface IssueEmailVerificationOptions {
  /** Link lifetime (`auth.verification.tokenTtlMs`); always validated by the caller's config. */
  readonly ttlMs: number;
  /** Injectable clock for tests; defaults to the wall clock. */
  readonly now?: Date;
}

export interface IssuedEmailVerification {
  /** The raw token: only the delivered link carries it, never the database or the logs. */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Rotates the user's outstanding link and returns the new token. A single active token per user
 * keeps the table small and makes "the latest email wins" true: re-registering or resending
 * invalidates the previous link.
 */
export async function issueEmailVerification(
  db: PolicyScopedDatabase,
  userId: string,
  options: IssueEmailVerificationOptions,
): Promise<IssuedEmailVerification> {
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + options.ttlMs);
  const token = randomToken(32);

  await db.delete(authEmailVerifications).where(eq(authEmailVerifications.userId, userId));
  await db.insert(authEmailVerifications).values({
    id: await sha256Hex(token),
    userId,
    createdAt: now,
    expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Consumes a verification link: marks the user verified and returns the user id, or `null` for an
 * unknown/expired token. The row is deleted before the expiry check, so a token is single-use even
 * when it is already stale.
 */
export async function consumeEmailVerification(
  db: PolicyScopedDatabase,
  token: string,
  now: Date = new Date(),
): Promise<{ userId: string } | null> {
  const id = await sha256Hex(token);
  const rows = await db
    .select({ userId: authEmailVerifications.userId, expiresAt: authEmailVerifications.expiresAt })
    .from(authEmailVerifications)
    .where(eq(authEmailVerifications.id, id))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;

  await db.delete(authEmailVerifications).where(eq(authEmailVerifications.id, id));
  if (row.expiresAt.getTime() <= now.getTime()) return null;

  const updated = await db
    .update(users)
    .set({ emailVerifiedAt: now })
    .where(eq(users.id, row.userId))
    .returning({ id: users.id });
  return updated[0] === undefined ? null : { userId: updated[0].id };
}

/**
 * Marks the account verified without a link. Used by the blueprint's development fallback (no
 * delivery channel configured in `development`/`test`, D-146) and by tests; production always
 * goes through the token.
 */
export async function markEmailVerified(
  db: PolicyScopedDatabase,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ emailVerifiedAt: now })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return updated[0] !== undefined;
}
