-- D-156: email verification for password accounts.
-- `users.email_verified_at` is the proof of mailbox ownership; accounts created before the
-- feature existed are backfilled as verified so enabling `auth.verification` does not lock out
-- an existing deployment. New registrations start NULL and are verified through the single-use
-- link stored (hashed) in `auth_email_verifications`.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;--> statement-breakpoint
UPDATE "users" SET "email_verified_at" = now() WHERE "email_verified_at" IS NULL;--> statement-breakpoint
CREATE TABLE "auth_email_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL
);--> statement-breakpoint
ALTER TABLE "auth_email_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_email_verifications" ADD CONSTRAINT "auth_email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_email_verifications_user_idx" ON "auth_email_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "auth_email_verifications" AS RESTRICTIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "auth_email_verifications_tenant_access" ON "auth_email_verifications" AS PERMISSIVE FOR ALL TO public USING (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL);
