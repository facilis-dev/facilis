import { defineAuthorizedHandler } from "@facilis.dev/core";
import { destroySession } from "@facilis.dev/auth";
import { clearSessionCookie, sessionIdFromRequest } from "@facilis.dev/nitro/session";

export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: ["sessions"],
    description: "Destroy the current session and clear the cookie.",
  },
  async (event, { db, log }) => {
    // The cookie is cleared on EVERY exit, including a broken session: h3 stages it on the
    // event's response headers, the only surface that survives this response path (D-038).
    clearSessionCookie(event);

    const sessionId = sessionIdFromRequest(event);
    if (sessionId === null) {
      log.audit({ operation: "auth:logout", outcome: "succeeded" });
      return { ok: true };
    }

    try {
      await destroySession(db, sessionId);
    } catch {
      // A broken/expired session is already logged out; the cookie clearing above stands.
    }

    log.audit({ operation: "auth:logout", outcome: "succeeded" });
    return { ok: true };
  },
);
