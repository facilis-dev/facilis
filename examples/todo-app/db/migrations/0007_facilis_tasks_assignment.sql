ALTER TABLE "facilis_tasks" ADD COLUMN "assigned_permission" text;--> statement-breakpoint
CREATE INDEX "facilis_tasks_assigned_idx" ON "facilis_tasks" USING btree ("assigned_permission","status");