import { sql } from "drizzle-orm";
import {
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type PgColumn,
  type PgPolicy,
} from "drizzle-orm/pg-core";

import { rlsForTable, tenantColumn } from "@facilis/db";

const usersRls = rlsForTable({ tenantColumn: "tenant_id" });

/**
 * Auth tables (SPEC §5.3). Access is two-class (D-136): a table with RLS is reachable by the
 * app role under its policies; a table without RLS is system-only (`facilis_app` has no
 * privilege on it, only the audited system identity can read or write it).
 *
 * `role_permissions` and `roles` are the system-only pair: `role_permissions` is a
 * projection of facilis.config.ts, written only by migrations/seed and never read at runtime
 * (permissions come from the config through `expandRoles`). `sessions` and `user_roles` are
 * app-reachable, so they carry an RLS policy that inherits the parent `users` row's
 * visibility instead of restating tenant isolation.
 *
 * Users carry both policies: restrictive tenant isolation (D-008) AND-ed with a permissive
 * "tenant scope present" policy, since Postgres denies by default when no permissive policy
 * applies. Net effect: non-superusers only reach users of the tenant in `app.tenant_id`.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    // The registration insert has no session yet; the column takes the deployment tenant
    // from the policy-scope GUC (D-040). Postgres fills it before the RLS check runs.
    tenantId: tenantColumn(),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  () => [
    ...usersRls.policies,
    pgPolicy("users_tenant_access", {
      for: "all",
      using: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
      withCheck: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
    }),
  ],
).enableRLS();

/**
 * Inherits the parent `users` row's visibility instead of restating it (the D-053 pattern):
 * a session or role assignment is reachable exactly when the user it points at is visible in
 * the current tenant scope. This is what keeps the two tables app-reachable — their rows have
 * no tenant column of their own (D-136).
 */
function parentUserAccessPolicy(name: string, column: PgColumn): PgPolicy {
  const predicate = sql`exists (select 1 from ${users} u where u.id = ${column})`;
  return pgPolicy(name, { for: "all", using: predicate, withCheck: predicate });
}

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [parentUserAccessPolicy("sessions_user_access", table.userId)],
).enableRLS();

// System-only (no RLS): seeded by the migration, never read by a route (D-136).
export const roles = pgTable("roles", {
  name: text("name").primaryKey(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    role: text("role")
      .notNull()
      .references(() => roles.name),
    permission: text("permission").notNull(),
  },
  (table) => [primaryKey({ columns: [table.role, table.permission] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role")
      .notNull()
      .references(() => roles.name),
    assignedBy: uuid("assigned_by"),
    assignedAt: timestamp("assigned_at").defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role] }),
    parentUserAccessPolicy("user_roles_user_access", table.userId),
  ],
).enableRLS();

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type RolePermissionRow = typeof rolePermissions.$inferSelect;
export type UserRoleRow = typeof userRoles.$inferSelect;

/** Public projection of a user row: the password hash never leaves @facilis/auth. */
export type AuthUser = Pick<UserRow, "id" | "email" | "tenantId" | "createdAt">;
