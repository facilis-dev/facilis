import { z } from "zod";
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
  async (_event, { body, db, system, log }) => {
    // The duplicate check is a read: keep it on the anonymous, policy-scoped client so RLS
    // still decides what this caller may see.
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (existing.length > 0) {
      log.audit({ operation: "auth:register", outcome: "failed", errorCode: "conflict" });
      return fail("conflict", { email: "already_registered" });
    }

    // Hashing is CPU work: do it outside the elevated block (never hold the system role
    // across an operation that does not need it).
    const passwordHash = await hashPassword(body.password);

    // The caller is anonymous (registration runs before a session exists): it has no
    // permission on the auth tables, and RLS would deny these writes. They belong to the
    // framework's auth subsystem, not to the browser, so they run as the audited
    // `system:auth` actor — never by widening the anonymous route's permissions or by
    // handing the handler a raw database client.
    const registration = await system(
      {
        actor: "system:auth",
        operation: "user:register",
        reason: "Registration creates the user and default role before a session exists.",
        tables: ["users", "user_roles"],
      },
      async (systemDb) => {
        const [user] = await systemDb
          .insert(users)
          // The tenant comes from the deployment scope (FACILIS_TENANT_ID / DEFAULT_TENANT_ID),
          // set as app.tenant_id by defineAuthorizedHandler; the column default reads it (D-040).
          .values({ email: body.email, passwordHash })
          .returning({ id: users.id, email: users.email });

        if (user === undefined) return null;

        await systemDb
          .insert(userRoles)
          .values({ userId: user.id, role: config.auth.defaultRole })
          .onConflictDoNothing();

        // First registration whose email matches FACILIS_INITIAL_ADMIN becomes admin.
        const promoted = await registerInitialAdmin(systemDb, user.id);
        return { user, promoted };
      },
    );

    if (registration === null) {
      log.audit({ operation: "auth:register", outcome: "failed", errorCode: "internal_error" });
      return fail("internal_error");
    }

    // The initial-admin promotion is recorded as the resulting role, never the email.
    log.audit({
      operation: "auth:register",
      outcome: "succeeded",
      details: { role: registration.promoted ? "admin" : config.auth.defaultRole },
    });

    return {
      id: registration.user.id,
      email: registration.user.email,
      role: registration.promoted ? "admin" : config.auth.defaultRole,
    };
  },
);
