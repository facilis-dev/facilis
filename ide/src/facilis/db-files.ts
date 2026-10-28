// Database half of the Facilis probe template.
//
// db/schema.ts re-exports the @facilis/auth tables and declares todos with both
// RLS policies (SPEC 8.4.5 / D-008). db/migrations/ holds the committed DDL and
// role seed the runtime applies on boot (bootstrap.ts: migrations -> seed -> app
// role), copied from examples/todo-app so the probe exercises the real contract.

const schema = `import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ownerIsolationPolicy, tenantIsolationPolicy } from "@facilis/db";
import { rolePermissions, roles, sessions, userRoles, users } from "@facilis/auth";

// Appendix D step 2: the project schema re-exports the auth tables so drizzle-kit
// generates them together with the application tables.
export { rolePermissions, roles, sessions, userRoles, users };

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
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
`;

const migration0000 = `CREATE TABLE "role_permissions" (
	"role" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_permission_pk" PRIMARY KEY("role","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"name" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"due_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp DEFAULT now(),
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"password_hash" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_roles_name_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_roles_name_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "todos" AS RESTRICTIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_isolation" ON "todos" AS PERMISSIVE FOR ALL TO public USING ("owner_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("owner_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "users" AS RESTRICTIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "users_tenant_access" ON "users" AS PERMISSIVE FOR ALL TO public USING (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL);
`;

const migration0001 = `-- Seed migration generated from facilis.config.ts by @facilis/auth seedStatements().
-- role_permissions is a projection of the config and is written ONLY here (SPEC 5.3/8.4.2).
INSERT INTO roles (name) VALUES ('admin') ON CONFLICT DO NOTHING;
INSERT INTO roles (name) VALUES ('manager') ON CONFLICT DO NOTHING;
INSERT INTO roles (name) VALUES ('user') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('admin', '*') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('manager', 'todos:read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('manager', 'todos:write') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('manager', 'users:read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('user', 'todos:read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission) VALUES ('user', 'todos:write') ON CONFLICT DO NOTHING;
`;

export const dbFiles: Record<string, string> = {
  "db/schema.ts": schema,
  "db/migrations/0000_workable_absorbing_man.sql": migration0000,
  "db/migrations/0001_seed_roles.sql": migration0001,
};
