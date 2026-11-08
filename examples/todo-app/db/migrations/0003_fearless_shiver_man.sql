CREATE TABLE "facilis_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facilis_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "todo_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"todo_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todo_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "todo_files" ADD CONSTRAINT "todo_files_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_files" ADD CONSTRAINT "todo_files_file_id_facilis_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."facilis_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "facilis_files" AS RESTRICTIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "facilis_files_tenant_access" ON "facilis_files" AS PERMISSIVE FOR ALL TO public USING (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "todo_files" AS RESTRICTIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "parent_access" ON "todo_files" AS PERMISSIVE FOR ALL TO public USING (exists (select 1 from "todos" where "todos"."id" = "todo_files"."todo_id")) WITH CHECK (exists (select 1 from "todos" where "todos"."id" = "todo_files"."todo_id"));