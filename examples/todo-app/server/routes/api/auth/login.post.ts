import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import { createSession, users, verifyPassword } from "@facilis/auth";
import config from "~/facilis.config";
import { sessionCookie } from "~/server/utils/http";

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
    const maxAgeSeconds = Math.floor(config.auth.sessionDurationMs / 1000);

    // Staged on the event's response headers: a Set-Cookie on a returned Response is
    // lost in the in-VM Nitro dev path (D-038), and the login would look successful
    // while the very next request arrived anonymous.
    event.res?.headers.set("set-cookie", sessionCookie(session.id, maxAgeSeconds));

    return { userId: user.id };
  },
);
