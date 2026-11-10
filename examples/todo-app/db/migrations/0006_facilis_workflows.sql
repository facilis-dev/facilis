CREATE TABLE "facilis_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"input" jsonb NOT NULL,
	"progress" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"current_job_id" uuid,
	"waiting_task_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facilis_workflows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "facilis_workflows_status_created_idx" ON "facilis_workflows" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "facilis_workflows_name_idx" ON "facilis_workflows" USING btree ("name");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "facilis_workflows" AS RESTRICTIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "facilis_workflows_tenant_access" ON "facilis_workflows" AS PERMISSIVE FOR ALL TO public USING (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL);