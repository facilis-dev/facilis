import { and, eq, sql } from "drizzle-orm";

import type { PolicyScopedDatabase } from "@facilis.dev/db";

import type { IdentityClaims, SsoAudit, SystemRunner } from "./contracts.ts";
import { SsoError } from "./errors.ts";
import { authIdentities } from "./tables.ts";
import { normalizeEmail } from "../email.ts";
import { users, userRoles } from "../tables.ts";

/**
 * Account linking and JIT provisioning (D-120).
 *
 * The identity key is `(provider, subject)`: a changed email never breaks an existing link.
 * Without a link, the asserted email must be verified before it can match a user, and a user is
 * only created when the provider's `autoProvision` allows it. Every read/write happens inside the
 * caller's audited `ctx.system` elevation — never on a raw client (D-099).
 *
 * Races are handled with the unique keys the schema already has: `(provider, subject)` for the
 * identity and `users.email` for the user, both `ON CONFLICT DO NOTHING` followed by a re-read.
 */

export const IDENTITY_TABLES = ["auth_identities", "users", "user_roles"] as const;

const IDENTITY_ELEVATION = {
  actor: "system:auth:sso" as const,
  operation: "auth:sso:identity:resolve",
  reason: "Linking or provisioning the user happens before the SSO session exists.",
  tables: IDENTITY_TABLES,
};

export interface IdentityProviderPolicy {
  readonly id: string;
  readonly autoProvision: boolean;
  readonly defaultRole?: string;
}

export interface ResolveIdentityOptions {
  /** `config.auth.defaultRole`, used when the provider has no `defaultRole`. */
  readonly defaultRole: string;
  /**
   * `config.auth.verification.enabled` (D-156): with email verification on, a pending password
   * account is claimed (the IdP just proved the mailbox). With it off, the account was never
   * meant to be verified, so the link is refused instead of silently resetting its password.
   */
  readonly claimUnverifiedPasswordAccount: boolean;
  readonly audit: SsoAudit;
}

export type IdentityOutcome = "existing" | "linked" | "provisioned";

export interface IdentityResolution {
  readonly userId: string;
  readonly outcome: IdentityOutcome;
}

function roleFor(provider: IdentityProviderPolicy, options: ResolveIdentityOptions): string {
  return provider.defaultRole ?? options.defaultRole;
}

async function findIdentityUserId(
  db: PolicyScopedDatabase,
  provider: string,
  subject: string,
): Promise<string | null> {
  const rows = await db
    .select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, provider), eq(authIdentities.subject, subject)))
    .limit(1);
  return rows[0]?.userId ?? null;
}

async function findUserByEmail(
  db: PolicyScopedDatabase,
  email: string,
): Promise<{ id: string; passwordHash: string | null; emailVerifiedAt: Date | null } | null> {
  const rows = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * A service account exists only to back an API client: it must never complete an interactive
 * login. The generic `sso_account_not_found` is deliberate — the flow must not become a probe
 * for which addresses belong to a service identity.
 */
async function assertLoginable(db: PolicyScopedDatabase, userId: string): Promise<void> {
  const rows = await db
    .select({ isService: users.isService })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (rows[0]?.isService === true) throw new SsoError("sso_account_not_found");
}

async function touchIdentity(
  db: PolicyScopedDatabase,
  claims: IdentityClaims,
  now: Date,
): Promise<void> {
  await db
    .update(authIdentities)
    .set({ email: normalizeEmail(claims.email), lastLoginAt: now })
    .where(
      and(eq(authIdentities.provider, claims.provider), eq(authIdentities.subject, claims.subject)),
    );
}

/**
 * Resolves the Facilis user for a verified identity.
 *
 * Throws `sso_email_unverified` for an unverified email that has no existing link and
 * `sso_account_not_found` when provisioning is disabled; both are safe to redirect.
 */
export async function resolveIdentity(
  system: SystemRunner,
  claims: IdentityClaims,
  provider: IdentityProviderPolicy,
  options: ResolveIdentityOptions,
  now: Date = new Date(),
): Promise<IdentityResolution> {
  return system(IDENTITY_ELEVATION, async (db) => {
    const linked = await findIdentityUserId(db, claims.provider, claims.subject);
    if (linked !== null) {
      await assertLoginable(db, linked);
      await touchIdentity(db, claims, now);
      return { userId: linked, outcome: "existing" };
    }

    // An unverified email must never link to (or provision) an account: that is account takeover.
    if (!claims.emailVerified) throw new SsoError("sso_email_unverified");

    const existingUser = await findUserByEmail(db, claims.email);
    if (existingUser !== null) {
      await assertLoginable(db, existingUser.id);
      // Account pre-hijacking (SEC-02): a pending password account was registered by someone
      // who never proved they own the address, and with email verification enabled it cannot
      // even log in. The verified IdP email IS that proof now, so the identity claims the
      // account and the placeholder password is removed before linking (D-156): whoever
      // registered the address first loses it, the mailbox owner keeps it. A verified password
      // account belongs to the same proven mailbox and links without clearing anything.
      const claimed = existingUser.passwordHash !== null && existingUser.emailVerifiedAt === null;
      if (claimed) {
        // With verification disabled the account was never meant to prove its mailbox: refuse
        // rather than silently reset a password its owner may still use (D-156).
        if (!options.claimUnverifiedPasswordAccount) throw new SsoError("sso_email_conflict");
        await db
          .update(users)
          .set({ passwordHash: null, emailVerifiedAt: now })
          .where(eq(users.id, existingUser.id));
      }
      const inserted = await db
        .insert(authIdentities)
        .values({
          provider: claims.provider,
          subject: claims.subject,
          userId: existingUser.id,
          email: normalizeEmail(claims.email),
        })
        .onConflictDoNothing()
        .returning({ userId: authIdentities.userId });
      const raced =
        inserted[0]?.userId ?? (await findIdentityUserId(db, claims.provider, claims.subject));
      if (raced === null) throw new SsoError("sso_internal_error", "identity link race");
      await touchIdentity(db, claims, now);
      options.audit({
        operation: "auth:sso:link",
        outcome: "succeeded",
        tables: claimed ? ["auth_identities", "users"] : ["auth_identities"],
        details: {
          provider: claims.provider,
          ...(claimed ? { claimed: "unverified_password" } : {}),
        },
      });
      return { userId: raced, outcome: "linked" };
    }

    if (!provider.autoProvision) throw new SsoError("sso_account_not_found");

    const role = roleFor(provider, options);
    const created = await db
      .insert(users)
      .values({ email: normalizeEmail(claims.email), passwordHash: null })
      .onConflictDoNothing()
      .returning({ id: users.id });
    const userId = created[0]?.id ?? (await findUserByEmail(db, claims.email))?.id ?? null;
    if (userId === null) throw new SsoError("sso_internal_error", "user provision race");

    await db.insert(userRoles).values({ userId, role }).onConflictDoNothing();
    const identity = await db
      .insert(authIdentities)
      .values({
        provider: claims.provider,
        subject: claims.subject,
        userId,
        email: normalizeEmail(claims.email),
      })
      .onConflictDoNothing()
      .returning({ userId: authIdentities.userId });
    const resolved =
      identity[0]?.userId ?? (await findIdentityUserId(db, claims.provider, claims.subject));
    if (resolved === null) throw new SsoError("sso_internal_error", "identity provision race");

    options.audit({
      operation: "auth:sso:provision",
      outcome: "succeeded",
      tables: ["users", "user_roles", "auth_identities"],
      details: { provider: claims.provider, role },
    });
    return { userId: resolved, outcome: "provisioned" };
  });
}
