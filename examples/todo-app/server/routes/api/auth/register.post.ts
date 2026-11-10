import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineAuthorizedHandler } from "@facilis/core";
import {
  hashPassword,
  normalizeEmail,
  registerInitialAdmin,
  userRoles,
  users,
} from "@facilis/auth";
import config from "~/facilis.config";

const registerRequestSchema = z.object({
  // Canonical form before any lookup or insert: the unique lower(email) index and the stored
  // value then agree, so a case variant can never create a second account (D-150).
  email: z.email().transform(normalizeEmail),
  password: z.string().min(8),
  // The operator's one-time bootstrap secret (SPEC §8.4.3, D-150). An email registration is
  // never promoted to admin without it, so knowing FACILIS_INITIAL_ADMIN is not enough.
  bootstrapToken: z.string().min(1).max(512).optional(),
});

/**
 * Registration is public and has no email verification (a framework capability the next
 * security pass introduces), so its response is deliberately generic: success and "already
 * registered" return the same body and status instead of an enumerable 409 (SEC-04). Callers
 * learn the outcome by logging in; the server audit records the real one.
 */
export default defineAuthorizedHandler(
  {
    permission: [],
    body: registerRequestSchema,
    dbTables: ["users", "user_roles"],
    dbColumns: ["users.email", "users.tenantId", "user_roles.role"],
    // Registration writes an account: throttled per client so the public surface cannot be used
    // to mass-create accounts (SEC-04, D-152).
    rateLimit: { maxRequests: 5, windowMs: 60_000 },
    description: "Register a user with the default role.",
  },
  async (_event, { body, db, system, log }) => {
    // The duplicate check is a read: keep it on the anonymous, policy-scoped client so RLS
    // still decides what this caller may see.
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (existing.length > 0) {
      log.audit({ operation: "auth:register", outcome: "failed", errorCode: "conflict" });
      return { accepted: true };
    }

    // Hashing is CPU work: do it outside the elevated block (never hold the system role
    // across an operation that does not need it).
    const passwordHash = await hashPassword(body.password);

    // The caller is anonymous (registration runs before a session exists): it has no
    // permission on the auth tables, and RLS would deny these writes. They belong to the
    // framework's auth subsystem, not to the browser, so they run as the audited
    // `system:auth` actor — never by widening the anonymous route's permissions or by
    // handing the handler a raw database client.
    const registration = await system(
      {
        actor: "system:auth",
        operation: "user:register",
        reason: "Registration creates the user and default role before a session exists.",
        tables: ["users", "user_roles"],
      },
      async (systemDb) => {
        const [user] = await systemDb
          .insert(users)
          // The tenant comes from the deployment scope (FACILIS_TENANT_ID / DEFAULT_TENANT_ID),
          // set as app.tenant_id by defineAuthorizedHandler; the column default reads it (D-040).
          .values({ email: body.email, passwordHash })
          .returning({ id: users.id, email: users.email });

        if (user === undefined) return null;

        await systemDb
          .insert(userRoles)
          .values({ userId: user.id, role: config.auth.defaultRole })
          .onConflictDoNothing();

        // The promotion needs the operator's bootstrap token, not the email alone (D-150).
        const promoted = await registerInitialAdmin(systemDb, user.id, body.bootstrapToken);
        return { user, promoted };
      },
    );

    if (registration === null) {
      log.audit({ operation: "auth:register", outcome: "failed", errorCode: "internal_error" });
      return { accepted: true };
    }

    // The initial-admin promotion is recorded as the resulting role, never the email or token.
    log.audit({
      operation: "auth:register",
      outcome: "succeeded",
      details: { role: registration.promoted ? "admin" : config.auth.defaultRole },
    });

    return { accepted: true };
  },
);
