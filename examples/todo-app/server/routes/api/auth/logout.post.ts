import { defineAuthorizedHandler } from "@facilis/core";
import { destroySession } from "@facilis/auth";
import { clearedSessionCookie, sessionIdFromCookieHeader } from "~/server/utils/http";

export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: ["sessions"],
    description: "Destroy the current session and clear the cookie.",
  },
  async (event, { db }) => {
    // The cookie is cleared on EVERY exit, including a broken session: staged on the
    // event's response headers, which is the surface that survives (D-038).
    event.res?.headers.set("set-cookie", clearedSessionCookie());

    const sessionId = sessionIdFromCookieHeader(event.req.headers.get("cookie"));
    if (sessionId === null) return { ok: true };

    try {
      await destroySession(db, sessionId);
    } catch {
      // A broken/expired session is already logged out; the cookie clearing above stands.
    }

    return { ok: true };
  },
);
