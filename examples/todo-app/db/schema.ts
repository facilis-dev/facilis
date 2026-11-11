import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  facilisFiles,
  facilisJobs,
  facilisTasks,
  facilisWorkflows,
  fileLinks,
  ownerIsolationPolicy,
  tenantColumn,
  tenantIsolationPolicy,
} from "@facilis/db";
import {
  apiClients,
  apiTokens,
  authIdentities,
  authSsoStates,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "@facilis/auth";

// Appendix D step 2: the project schema re-exports the auth tables so drizzle-kit
// generates them together with the application tables. The job queue, the manual tasks, the
// workflows and the binary-file metadata are framework state the project owns the DDL for,
// so they are re-exported the same way (D-107, D-135, D-053), and the API-client tables are
// auth state (V3a).
export {
  apiClients,
  apiTokens,
  authIdentities,
  authSsoStates,
  facilisFiles,
  facilisJobs,
  facilisTasks,
  facilisWorkflows,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
};

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

// One todo "contains" files through a real link table (D-053): cascading FKs to the parent
// row and to facilis_files, a restrictive tenant policy, and a parent_access policy that
// evaluates the parent's own RLS, so a link is visible exactly when its todo is.
export const todoFiles = fileLinks(todos, { table: "todo_files", column: "todo_id" });
