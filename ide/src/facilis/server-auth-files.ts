// Auth + database routes of the Facilis probe template.
//
// The probe used to stop at an unauthenticated /api/todos -> 401, so nothing proved
// that PGlite, the migrations, the session middleware, permissions and RLS actually work
// inside the WebContainer. These are the reference app's own routes (examples/todo-app),
// narrowed to what the probe needs: register, log in, and the authenticated write in
// server-files.ts. The probe app drives them and reports the roundtrip to the smoke.

const registerRoute = `import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import { hashPassword, registerInitialAdmin, userRoles, users } from "@facilis/auth";
import config from "~/facilis.config";

export default defineAuthorizedHandler(
  {
    permission: [],
    body: z.object({ email: z.email(), password: z.string().min(8) }),
    dbTables: ["users", "user_roles"],
    dbColumns: ["users.email", "users.tenantId", "user_roles.role"],
    description: "Register a user with the default role.",
  },
  async (_event, { body, db }) => {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (existing.length > 0) return fail("conflict", { email: "already_registered" });

    const passwordHash = await hashPassword(body.password);
    const [user] = await db
      .insert(users)
      // D-040: the column default fills the tenant from the deployment scope
      // (FACILIS_TENANT_ID), the only tenant this deployment will ever accept.
      .values({ email: body.email, passwordHash })
      .returning({ id: users.id, email: users.email });

    if (user === undefined) return fail("internal_error");

    await db
      .insert(userRoles)
      .values({ userId: user.id, role: config.auth.defaultRole })
      .onConflictDoNothing();

    // First registration whose email matches FACILIS_INITIAL_ADMIN becomes admin.
    const promoted = await registerInitialAdmin(db, user.id);

    return {
      id: user.id,
      email: user.email,
      role: promoted ? "admin" : config.auth.defaultRole,
    };
  },
);
`;

// The cookie is set by the framework's helper, which calls h3's `setCookie`: the cookie
// has to be staged on the EVENT's response headers. A Set-Cookie carried on a Response the
// route returns is dropped in this Nitro dev path (measured in the WebContainer: login 200,
// the next request had no Cookie at all). h3 merges event headers into the final response.
const loginRoute = `import { z } from "zod";
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
    setSessionCookie(event, session.id, { ttlMs: config.auth.sessionDurationMs });

    return { userId: user.id };
  },
);
`;

// A cookie is HttpOnly and forbidden to page JS, so a session that never came back is
// invisible in the browser. This route reports what the SERVER saw, which is what makes
// a failed preview-cookie-jar roundtrip diagnosable at all.
const sessionRoute = `import { defineAuthorizedHandler, fail } from "@facilis/core";

export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: ["users", "sessions"],
    description: "Return the current session, or authenticated: false.",
  },
  async (event) => {
    const auth = event.context.auth ?? null;
    if (auth === null) {
      return { authenticated: false, cookiePresent: event.req.headers.has("cookie") };
    }

    if (typeof auth.userId !== "string") return fail("internal_error");

    return {
      authenticated: true,
      userId: auth.userId,
      roles: auth.roles,
      permissions: auth.permissions,
    };
  },
);
`;

export const serverAuthFiles: Record<string, string> = {
  "server/routes/api/auth/register.post.ts": registerRoute,
  "server/routes/api/auth/login.post.ts": loginRoute,
  "server/routes/api/auth/session.get.ts": sessionRoute,
};
