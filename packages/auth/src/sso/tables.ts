import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { rlsForTable, tenantColumn } from "@facilis.dev/db";

import { users } from "../tables.ts";

const identitiesRls = rlsForTable({ tenantColumn: "tenant_id" });
const statesRls = rlsForTable({ tenantColumn: "tenant_id" });

/**
 * SSO identity links (D-120, SPEC §5.3): one row per `(provider, subject)` pair.
 *
 * The identity key is the IdP's stable subject, never the email: a user who changes their email
 * at the IdP keeps the link. `email` is the address reported at the last sign-in, for operators.
 *
 * RLS matches `users`: restrictive tenant isolation AND-ed with a permissive "tenant scope
 * present" policy, because Postgres denies by default when no permissive policy applies.
 */
export const authIdentities = pgTable(
  "auth_identities",
  {
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tenantId: tenantColumn(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.subject] }),
    ...identitiesRls.policies,
    pgPolicy("auth_identities_tenant_access", {
      for: "all",
      using: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
      withCheck: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
    }),
  ],
).enableRLS();

/**
 * One SSO login attempt (D-120): single-use state plus whatever the protocol needs to finish
 * (`nonce`/`code_verifier` for OIDC, `request_id` for SAML, `redirect_to` for the browser).
 *
 * The row is written and consumed inside the audited `ctx.system` elevation, so RLS is not the
 * load-bearing check here, but every scoped table ships the standard policies (SPEC §8.3).
 */
export const authSsoStates = pgTable(
  "auth_sso_states",
  {
    state: text("state").primaryKey(),
    provider: text("provider").notNull(),
    nonce: text("nonce"),
    codeVerifier: text("code_verifier"),
    requestId: text("request_id"),
    redirectTo: text("redirect_to"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    tenantId: tenantColumn(),
  },
  () => [
    ...statesRls.policies,
    pgPolicy("auth_sso_states_tenant_access", {
      for: "all",
      using: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
      withCheck: sql`nullif(current_setting('app.tenant_id', true), '') IS NOT NULL`,
    }),
  ],
).enableRLS();

export type AuthIdentityRow = typeof authIdentities.$inferSelect;
export type NewAuthIdentityRow = typeof authIdentities.$inferInsert;
export type AuthSsoStateRow = typeof authSsoStates.$inferSelect;
export type NewAuthSsoStateRow = typeof authSsoStates.$inferInsert;
