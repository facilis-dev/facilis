import { getTableConfig } from "drizzle-orm/pg-core";

import {
  applyStatements,
  createDb,
  ensureAppRole,
  policyCreateSql,
  type FacilisDb,
} from "@facilis/db";

import { users } from "./tables.ts";

/**
 * Hand-written DDL matching the drizzle tables exactly (no drizzle-kit in CI). Column
 * names, nullability, defaults, keys and references mirror ./tables.ts.
 */
export const AUTH_TABLE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    tenant_id uuid NOT NULL,
    password_hash text,
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
];

const USERS_POLICY_STATEMENTS: readonly string[] = [
  "ALTER TABLE users ENABLE ROW LEVEL SECURITY",
  ...getTableConfig(users).policies.map((policy) => policyCreateSql("users", policy)),
];

let cachedStatements: readonly string[] | undefined;

function authSchemaStatements(): readonly string[] {
  cachedStatements ??= [...AUTH_TABLE_STATEMENTS, ...USERS_POLICY_STATEMENTS];
  return cachedStatements;
}

/** Boots an in-memory PGlite db with the auth schema, RLS policies and app role. */
export async function createAuthTestDb(): Promise<FacilisDb> {
  const db = await createDb();
  await applyStatements(db, authSchemaStatements());
  await ensureAppRole(db);
  return db;
}
