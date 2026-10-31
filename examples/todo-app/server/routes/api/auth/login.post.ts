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
    dbColumns: ["users.email", "sessions.userId"],
    description: "Log in and start a session.",
  },
  async (event, { body, db }) => {
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    // Same response for unknown email and wrong password: no account enumeration.
    if (user === undefined || user.passwordHash === null) return fail("unauthorized");
    if (!(await verifyPassword(user.passwordHash, body.password))) return fail("unauthorized");

    const session = await createSession(db, user.id, { ttlMs: config.auth.sessionDurationMs });
    // h3's setCookie under the hood: it stages the cookie on the event's response headers,
    // the only surface that survives this response path (D-038).
    setSessionCookie(event, session.id, { ttlMs: config.auth.sessionDurationMs });

    return { userId: user.id };
  },
);
