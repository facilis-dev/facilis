-- D-145: the queue is still tenant-scoped (D-008 tenant_isolation) but access is now
-- permission-gated at the database level: SELECT needs jobs:read, every mutation needs
-- jobs:exec. The old tenant-only permissive policy would OR-allow everything, so it goes.
DROP POLICY IF EXISTS "facilis_jobs_tenant_access" ON "facilis_jobs";--> statement-breakpoint
CREATE POLICY "facilis_jobs_read" ON "facilis_jobs" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.permissions', true), '')::jsonb ? 'jobs:read');--> statement-breakpoint
CREATE POLICY "facilis_jobs_insert" ON "facilis_jobs" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.permissions', true), '')::jsonb ? 'jobs:exec');--> statement-breakpoint
CREATE POLICY "facilis_jobs_update" ON "facilis_jobs" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.permissions', true), '')::jsonb ? 'jobs:exec') WITH CHECK (nullif(current_setting('app.permissions', true), '')::jsonb ? 'jobs:exec');--> statement-breakpoint
CREATE POLICY "facilis_jobs_delete" ON "facilis_jobs" AS PERMISSIVE FOR DELETE TO public USING (nullif(current_setting('app.permissions', true), '')::jsonb ? 'jobs:exec');
