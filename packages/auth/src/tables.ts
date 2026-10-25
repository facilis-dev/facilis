import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { rlsForTable } from "@facilis/db";

const usersRls = rlsForTable({ tenantColumn: "tenant_id" });

/**
 * Auth tables (SPEC §5.3). `role_permissions` is a projection of facilis.config.ts and is
 * written only by migrations/seed, never at runtime.
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
    tenantId: uuid("tenant_id").notNull(),
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

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
});

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
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type RolePermissionRow = typeof rolePermissions.$inferSelect;
export type UserRoleRow = typeof userRoles.$inferSelect;

/** Public projection of a user row: the password hash never leaves @facilis/auth. */
export type AuthUser = Pick<UserRow, "id" | "email" | "tenantId" | "createdAt">;
