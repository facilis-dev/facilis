import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import {
  applyStatements,
  createDb,
  ensureAppRole,
  policyCreateSql,
  type FacilisDb,
} from "@facilis/db";

import { authIdentities, authSsoStates } from "./sso/tables.ts";
import {
  apiClients,
  apiTokens,
  authEmailVerifications,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "./tables.ts";

/**
 * Hand-written DDL matching the drizzle tables exactly (no drizzle-kit in CI). Column
 * names, nullability, defaults, keys and references mirror ./tables.ts.
 */
export const AUTH_TABLE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    tenant_id uuid NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid,
    password_hash text,
    is_service boolean NOT NULL DEFAULT false,
    email_verified_at timestamp,
    created_at timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    expires_at timestamp NOT NULL
  )`,
  "CREATE TABLE IF NOT EXISTS roles (name text PRIMARY KEY)",
  `CREATE TABLE IF NOT EXISTS role_permissions (
    role text NOT NULL REFERENCES roles(name),
    permission text NOT NULL,
    PRIMARY KEY (role, permission)
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id uuid NOT NULL REFERENCES users(id),
    role text NOT NULL REFERENCES roles(name),
    assigned_by uuid,
    assigned_at timestamp DEFAULT now(),
    PRIMARY KEY (user_id, role)
  )`,
  `CREATE TABLE IF NOT EXISTS api_clients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL UNIQUE,
    secret_hash text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id),
    created_by uuid,
    created_at timestamp DEFAULT now(),
    revoked_at timestamp,
    last_used_at timestamp
  )`,
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash text NOT NULL UNIQUE,
    client_id uuid NOT NULL REFERENCES api_clients(id),
    user_id uuid NOT NULL REFERENCES users(id),
    expires_at timestamp NOT NULL,
    created_at timestamp DEFAULT now(),
    revoked_at timestamp,
    last_used_at timestamp
  )`,
  `CREATE TABLE IF NOT EXISTS auth_identities (
    provider text NOT NULL,
    subject text NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email text NOT NULL,
    tenant_id uuid NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid,
    created_at timestamp DEFAULT now() NOT NULL,
    last_login_at timestamp DEFAULT now() NOT NULL,
    PRIMARY KEY (provider, subject)
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sso_states (
    state text PRIMARY KEY,
    provider text NOT NULL,
    nonce text,
    code_verifier text,
    request_id text,
    redirect_to text,
    created_at timestamp DEFAULT now() NOT NULL,
    expires_at timestamp NOT NULL,
    tenant_id uuid NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid
  )`,
  `CREATE TABLE IF NOT EXISTS auth_email_verifications (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamp DEFAULT now() NOT NULL,
    expires_at timestamp NOT NULL,
    tenant_id uuid NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid
  )`,
];

const RLS_TABLES: readonly (readonly [string, PgTable])[] = [
  ["users", users],
  ["sessions", sessions],
  ["roles", roles],
  ["role_permissions", rolePermissions],
  ["user_roles", userRoles],
  ["api_clients", apiClients],
  ["api_tokens", apiTokens],
  ["auth_identities", authIdentities],
  ["auth_sso_states", authSsoStates],
  ["auth_email_verifications", authEmailVerifications],
];

/**
 * RLS wiring derived from the same drizzle tables the DDL mirrors, so a new policy (D-136)
 * cannot land in the schema and stay out of the test database. Tables without `enableRLS`
 * (`roles`, `role_permissions`) are system-only and contribute no statement.
 */
const AUTH_RLS_STATEMENTS: readonly string[] = RLS_TABLES.flatMap(([name, table]) => {
  const config = getTableConfig(table);
  if (!config.enableRLS) return [];
  const statements = [`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY`];
  for (const policy of config.policies) statements.push(policyCreateSql(name, policy));
  return statements;
});

let cachedStatements: readonly string[] | undefined;

function authSchemaStatements(): readonly string[] {
  cachedStatements ??= [...AUTH_TABLE_STATEMENTS, ...AUTH_RLS_STATEMENTS];
  return cachedStatements;
}

/**
 * Boots an in-memory PGlite db with the auth schema, its RLS policies and the app role:
 * `ensureAppRole` then grants only the RLS-enabled tables and revokes the system-only pair.
 */
export async function createAuthTestDb(): Promise<FacilisDb> {
  const db = await createDb();
  await applyStatements(db, authSchemaStatements());
  await ensureAppRole(db);
  return db;
}
