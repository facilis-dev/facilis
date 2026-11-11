ALTER TABLE "users" ADD COLUMN "is_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now(),
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	CONSTRAINT "api_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "api_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "api_clients_user_access" ON "api_clients" AS PERMISSIVE FOR ALL TO public USING (exists (select 1 from "users" u where u.id = "api_clients"."user_id")) WITH CHECK (exists (select 1 from "users" u where u.id = "api_clients"."user_id"));--> statement-breakpoint
CREATE POLICY "api_tokens_user_access" ON "api_tokens" AS PERMISSIVE FOR ALL TO public USING (exists (select 1 from "users" u where u.id = "api_tokens"."user_id")) WITH CHECK (exists (select 1 from "users" u where u.id = "api_tokens"."user_id"));
