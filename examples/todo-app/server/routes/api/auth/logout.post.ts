import { defineAuthorizedHandler } from "@facilis/core";
import { destroySession } from "@facilis/auth";
import { clearedSessionCookie, jsonResponse, sessionIdFromCookieHeader } from "~/server/utils/http";

export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: ["sessions"],
    description: "Destroy the current session and clear the cookie.",
  },
  async (event, { db }) => {
    const sessionId = sessionIdFromCookieHeader(event.req.headers.get("cookie"));
    if (sessionId === null)
      return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie() });

    try {
      await destroySession(db, sessionId);
    } catch {
      // A broken/expired session must still clear the cookie.
      return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie() });
    }

    return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie() });
  },
);
