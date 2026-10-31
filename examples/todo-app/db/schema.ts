import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ownerIsolationPolicy, tenantColumn, tenantIsolationPolicy } from "@facilis/db";
import { rolePermissions, roles, sessions, userRoles, users } from "@facilis/auth";

// Appendix D step 2: the project schema re-exports the auth tables so drizzle-kit
// generates them together with the application tables.
export { rolePermissions, roles, sessions, userRoles, users };

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Taken from app.tenant_id by the DB default; the RLS policy checks the same GUC (D-040).
    tenantId: tenantColumn(),
    ownerId: uuid("owner_id").notNull(),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    dueDate: timestamp("due_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Tenant isolation is emitted AS RESTRICTIVE (AND-ed); owner isolation stays
  // permissive. See spec 8.4.5 and D-008.
  () => [tenantIsolationPolicy(), ownerIsolationPolicy()],
).enableRLS();
