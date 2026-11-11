import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import { createSession, users, verifyPassword } from "@facilis/auth";
import { setSessionCookie } from "@facilis/nitro/session";
import config from "~/facilis.config";

export default defineAuthorizedHandler(
  {
    permission: [],
    body: z.object({ email: z.email(), password: z.string().min(1) }),
    dbTables: ["users", "sessions"],
    dbColumns: ["users.email", "users.isService", "sessions.userId"],
    description: "Log in and start a session.",
  },
  async (event, { body, db, log }) => {
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash, isService: users.isService })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    // Same response for an unknown email, a wrong password and a service account (which has
    // no interactive credential): no account enumeration, and a client secret is only ever
    // exchanged at the token endpoint.
    if (user === undefined || user.passwordHash === null || user.isService) {
      log.audit({ operation: "auth:login", outcome: "failed", errorCode: "unauthorized" });
      return fail("unauthorized");
    }
    if (!(await verifyPassword(user.passwordHash, body.password))) {
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
