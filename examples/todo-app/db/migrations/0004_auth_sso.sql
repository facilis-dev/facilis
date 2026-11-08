CREATE TABLE "auth_identities" (
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_login_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_subject_pk" PRIMARY KEY("provider","subject")
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_sso_states" (
	"state" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"nonce" text,
	"code_verifier" text,
	"request_id" text,
	"redirect_to" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_sso_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "auth_identities" AS RESTRICTIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "auth_identities_tenant_access" ON "auth_identities" AS PERMISSIVE FOR ALL TO public USING (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "auth_sso_states" AS RESTRICTIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "auth_sso_states_tenant_access" ON "auth_sso_states" AS PERMISSIVE FOR ALL TO public USING (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL) WITH CHECK (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL);
