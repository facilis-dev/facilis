import { and, eq, sql } from "drizzle-orm";

import type { PolicyScopedDatabase } from "@facilis/db";

import type { IdentityClaims, SsoAudit, SystemRunner } from "./contracts.ts";
import { SsoError } from "./errors.ts";
import { authIdentities } from "./tables.ts";
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

async function findUserIdByEmail(db: PolicyScopedDatabase, email: string): Promise<string | null> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return rows[0]?.id ?? null;
}

async function touchIdentity(
  db: PolicyScopedDatabase,
  claims: IdentityClaims,
  now: Date,
): Promise<void> {
  await db
    .update(authIdentities)
    .set({ email: claims.email, lastLoginAt: now })
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
      await touchIdentity(db, claims, now);
      return { userId: linked, outcome: "existing" };
    }

    // An unverified email must never link to (or provision) an account: that is account takeover.
    if (!claims.emailVerified) throw new SsoError("sso_email_unverified");

    const existingUser = await findUserIdByEmail(db, claims.email);
    if (existingUser !== null) {
      const inserted = await db
        .insert(authIdentities)
        .values({
          provider: claims.provider,
          subject: claims.subject,
          userId: existingUser,
          email: claims.email,
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
        tables: ["auth_identities"],
        details: { provider: claims.provider },
      });
      return { userId: raced, outcome: "linked" };
    }

    if (!provider.autoProvision) throw new SsoError("sso_account_not_found");

    const role = roleFor(provider, options);
    const created = await db
      .insert(users)
      .values({ email: claims.email, passwordHash: null })
      .onConflictDoNothing()
      .returning({ id: users.id });
    const userId = created[0]?.id ?? (await findUserIdByEmail(db, claims.email));
    if (userId === null) throw new SsoError("sso_internal_error", "user provision race");

    await db.insert(userRoles).values({ userId, role }).onConflictDoNothing();
    const identity = await db
      .insert(authIdentities)
      .values({ provider: claims.provider, subject: claims.subject, userId, email: claims.email })
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
