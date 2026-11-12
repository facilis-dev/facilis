import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineAuthorizedHandler, fail } from "@facilis.dev/core";
import { createSession, normalizeEmail, users, verifyPassword } from "@facilis.dev/auth";
import { setSessionCookie } from "@facilis.dev/nitro/session";
import config from "~/facilis.config";

// A valid PBKDF2 hash of a throwaway password (600k iterations, D-148). The route verifies it
// when the account does not exist or has no password, so the PBKDF2 cost — and therefore the
// response time — is the same whether the email exists or not.
const DUMMY_PASSWORD_HASH =
  "pbkdf2-sha256$600000$RmFjaWxpc0R1bW15U2FsdA==$R2c7KfLrtYyb8TrjXFu297bFQ85/YdT+ZBqc1GLuiEc=";

export default defineAuthorizedHandler(
  {
    permission: [],
    // Canonical form before the lookup: one account per email, regardless of case (D-150).
    body: z.object({ email: z.email().transform(normalizeEmail), password: z.string().min(1) }),
    dbTables: ["users", "sessions"],
    dbColumns: ["users.email", "users.isService", "sessions.userId"],
    // Brute force is throttled per client before the PBKDF2 comparison (SEC-04, D-152).
    rateLimit: { maxRequests: 10, windowMs: 60_000 },
    description: "Log in and start a session.",
  },
  async (event, { body, db, log }) => {
    const [user] = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        isService: users.isService,
      })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    // Same response AND the same PBKDF2 cost for an unknown email, an account without a
    // password and a service account: no enumeration by body or by timing (SEC-11). Service
    // accounts have no password and never start an interactive session.
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    if (user === undefined || user.passwordHash === null || user.isService) {
      await verifyPassword(passwordHash, body.password);
      log.audit({ operation: "auth:login", outcome: "failed", errorCode: "unauthorized" });
      return fail("unauthorized");
    }
    if (!(await verifyPassword(passwordHash, body.password))) {
      log.audit({ operation: "auth:login", outcome: "failed", errorCode: "unauthorized" });
      return fail("unauthorized");
    }

    const session = await createSession(db, user.id, { ttlMs: config.auth.sessionDurationMs });
    // h3's setCookie under the hood: it stages the cookie on the event's response headers,
    // the only surface that survives this response path (D-038).
    setSessionCookie(event, session.id, { ttlMs: config.auth.sessionDurationMs });
    // Audit the successful password sign-in by method only: never the email or password.
    log.audit({ operation: "auth:login", outcome: "succeeded", details: { method: "password" } });

    return { userId: user.id };
  },
);
