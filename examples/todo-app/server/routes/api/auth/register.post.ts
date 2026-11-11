import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  defineAuthorizedHandler,
  type FacilisHandlerEvent,
  type FacilisLogger,
  type SystemHandler,
} from "@facilis.dev/core";
import {
  consumeEmailVerification,
  EMAIL_VERIFICATION_TABLES,
  hashPassword,
  issueEmailVerification,
  normalizeEmail,
  registerInitialAdmin,
  userRoles,
  users,
} from "@facilis.dev/auth";
import config from "~/facilis.config";
import { deliverVerificationEmail, verificationUrl } from "~/server/utils/email-verification";

const registerRequestSchema = z.object({
  // Canonical form before any lookup or insert: the unique lower(email) index and the stored
  // value then agree, so a case variant can never create a second account (D-150).
  email: z.email().transform(normalizeEmail),
  password: z.string().min(8),
  // The operator's one-time bootstrap secret (SPEC §8.4.3, D-150). An email registration is
  // never promoted to admin without it, so knowing FACILIS_INITIAL_ADMIN is not enough.
  bootstrapToken: z.string().min(1).max(512).optional(),
});

interface Registration {
  readonly kind: "created" | "unverified" | "duplicate";
  readonly userId: string;
  /** Set only for `created`: the bootstrap promotion happened. */
  readonly promoted?: boolean;
}

/**
 * Registration is public and does not start a session. The response is deliberately generic
 * (SEC-04): success and "already registered" return the same body and status instead of an
 * enumerable 409, and the server audit records the real outcome.
 *
 * Email verification (D-156, `auth.verification.enabled`): a new account starts unverified and
 * receives a single-use link. Re-registering an email whose account is still UNVERIFIED claims
 * that account (the password is replaced and the previous link dies): whoever controls the
 * mailbox proves it, while the first registrant — who never could — loses the placeholder.
 */
export default defineAuthorizedHandler(
  {
    permission: [],
    body: registerRequestSchema,
    dbTables: ["users", "user_roles", "auth_email_verifications"],
    dbColumns: ["users.email", "users.tenantId", "user_roles.role"],
    // Registration writes an account: throttled per client so the public surface cannot be used
    // to mass-create accounts (SEC-04, D-152).
    rateLimit: { maxRequests: 5, windowMs: 60_000 },
    description: "Register a user with the default role.",
  },
  async (event, { body, db, system, log }) => {
    // The duplicate/pending check is a read on the anonymous, policy-scoped client so RLS still
    // decides what this caller may see.
    const [existing] = await db
      .select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    // Hashing is CPU work and runs for every attempt (duplicate or not), so the response time
    // does not reveal whether the email is already registered.
    const passwordHash = await hashPassword(body.password);

    // The caller is anonymous (registration runs before a session exists): the auth tables belong
    // to the framework, so the writes run as the audited `system:auth` actor instead of widening
    // the route's permissions (D-099).
    const registration = await system(
      {
        actor: "system:auth",
        operation: "user:register",
        reason: "Registration creates the user and default role before a session exists.",
        tables: ["users", "user_roles"],
      },
      async (systemDb): Promise<Registration | null> => {
        if (existing !== undefined) {
          if (existing.emailVerifiedAt !== null) {
            return { kind: "duplicate", userId: existing.id };
          }
          // A pending account is not owned by anyone yet (D-156): the re-registration takes it
          // over with a new password; the stale verification link is rotated below.
          await systemDb.update(users).set({ passwordHash }).where(eq(users.id, existing.id));
          return { kind: "unverified", userId: existing.id };
        }

        const [user] = await systemDb
          .insert(users)
          // The tenant comes from the deployment scope (FACILIS_TENANT_ID / DEFAULT_TENANT_ID),
          // set as app.tenant_id by defineAuthorizedHandler; the column default reads it (D-040).
          .values({ email: body.email, passwordHash })
          .returning({ id: users.id });
        if (user === undefined) return null;

        await systemDb
          .insert(userRoles)
          .values({ userId: user.id, role: config.auth.defaultRole })
          .onConflictDoNothing();

        // The promotion needs the operator's bootstrap token, not the email alone (D-150).
        const promoted = await registerInitialAdmin(systemDb, user.id, body.bootstrapToken);
        return { kind: "created", userId: user.id, promoted };
      },
    );

    if (registration === null) {
      log.audit({ operation: "auth:register", outcome: "failed", errorCode: "internal_error" });
      return { accepted: true };
    }

    if (registration.kind === "duplicate") {
      log.audit({ operation: "auth:register", outcome: "failed", errorCode: "conflict" });
      return { accepted: true };
    }

    if (config.auth.verification.enabled) {
      await sendVerificationLink(event, system, log, registration.userId, body.email);
    }

    // The initial-admin promotion is recorded as the resulting role, never the email or token.
    log.audit({
      operation: "auth:register",
      outcome: "succeeded",
      details: { role: registration.promoted === true ? "admin" : config.auth.defaultRole },
    });

    return { accepted: true };
  },
);

/**
 * Issues and delivers the single-use link. A delivery failure is logged but never changes the
 * response (that would make registration an existence/enumeration oracle); a later
 * re-registration rotates the token and retries.
 */
async function sendVerificationLink(
  event: FacilisHandlerEvent,
  system: SystemHandler,
  log: FacilisLogger,
  userId: string,
  email: string,
): Promise<void> {
  const issued = await system(
    {
      actor: "system:auth",
      operation: "auth:email:verification:issue",
      reason: "The verification link is created before a session exists.",
      tables: EMAIL_VERIFICATION_TABLES,
    },
    (systemDb) =>
      issueEmailVerification(systemDb, userId, {
        ttlMs: config.auth.verification.tokenTtlMs,
      }),
  );

  try {
    const delivery = await deliverVerificationEmail({
      to: email,
      link: verificationUrl(event, issued.token),
    });
    if (delivery.devShortcut) {
      // No mailbox in development/test: consume the link immediately, so the demo and the IDE
      // smoke run log in right after registration. Production always sends the email.
      await system(
        {
          actor: "system:auth",
          operation: "auth:email:verification:consume",
          reason: "Development fallback verifies the account without delivery (D-156).",
          tables: EMAIL_VERIFICATION_TABLES,
        },
        (systemDb) => consumeEmailVerification(systemDb, issued.token),
      );
    }
  } catch (error) {
    log.error("auth: verification email delivery failed", { error: String(error) });
    log.audit({
      operation: "auth:email:verification:deliver",
      outcome: "failed",
      errorCode: "internal_error",
    });
  }
}
