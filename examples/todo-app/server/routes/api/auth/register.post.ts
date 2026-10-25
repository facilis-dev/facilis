import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import { hashPassword, registerInitialAdmin, userRoles, users } from "@facilis/auth";
import config from "~/facilis.config";
import { tenantIdFromEnv } from "~/server/utils/tenant";

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
      .values({ email: body.email, tenantId: tenantIdFromEnv(), passwordHash })
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
