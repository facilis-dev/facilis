CREATE TABLE "facilis_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid,
	"step_index" integer,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"decision" text,
	"title_key" text NOT NULL,
	"title_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb,
	"requested_by" text,
	"expires_at" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facilis_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "facilis_tasks_status_created_idx" ON "facilis_tasks" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "facilis_tasks_workflow_idx" ON "facilis_tasks" USING btree ("workflow_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "facilis_tasks" AS RESTRICTIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "facilis_tasks_tenant_access" ON "facilis_tasks" AS PERMISSIVE FOR ALL TO public USING (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL);
