import { eq } from "drizzle-orm";

import type { PolicyScopedDatabase } from "@facilis/db";

import type { AuthConfig } from "./roles.ts";
import { userRoles, users } from "./tables.ts";

const INITIAL_ADMIN_ROLE = "admin";

export interface SeedEntry {
  readonly role: string;
  readonly permission: string;
}

/**
 * Pure projection of `config.auth.roles` into `role_permissions` rows (SPEC §5.3/§8.4.2).
 * Wildcards stay literal ("*") exactly as the reference seed shows; the table is written
 * only at migration time, never at runtime.
 */
export function seedFromConfig(config: AuthConfig): SeedEntry[] {
  const entries: SeedEntry[] = [];
  const seen = new Set<string>();

  for (const [role, permissions] of Object.entries(config.roles)) {
    for (const permission of permissions) {
      const key = `${role}\u0000${permission}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ role, permission });
    }
  }

  return entries;
}

/**
 * Deterministic, idempotent SQL for the migration/seed step: roles first, then
 * role_permissions, every statement guarded by ON CONFLICT DO NOTHING.
 */
export function seedStatements(config: AuthConfig): string[] {
  const statements: string[] = [];

  for (const role of Object.keys(config.roles)) {
    statements.push(
      `INSERT INTO roles (name) VALUES (${sqlLiteral(role)}) ON CONFLICT DO NOTHING;`,
    );
  }
  for (const { role, permission } of seedFromConfig(config)) {
    statements.push(
      `INSERT INTO role_permissions (role, permission) VALUES (${sqlLiteral(role)}, ${sqlLiteral(permission)}) ON CONFLICT DO NOTHING;`,
    );
  }

  return statements;
}

/**
 * Grants `admin` to the user whose email matches FACILIS_INITIAL_ADMIN (SPEC §8.4.3).
 * Accepts a user id or email; returns false when the env var is unset, the user does not
 * exist, or the email differs. Emails compare case-insensitively.
 */
export async function registerInitialAdmin(
  db: PolicyScopedDatabase,
  userIdOrEmail: string,
): Promise<boolean> {
  const expected = readInitialAdminEmail();
  if (expected === null) return false;

  const user = await findUser(db, userIdOrEmail.trim());
  if (user === null) return false;
  if (user.email.trim().toLowerCase() !== expected) return false;

  await db
    .insert(userRoles)
    .values({ userId: user.id, role: INITIAL_ADMIN_ROLE })
    .onConflictDoNothing();
  return true;
}

function readInitialAdminEmail(): string | null {
  const configured = process.env.FACILIS_INITIAL_ADMIN?.trim();
  return configured === undefined || configured.length === 0 ? null : configured.toLowerCase();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findUser(
  db: PolicyScopedDatabase,
  userIdOrEmail: string,
): Promise<{ id: string; email: string } | null> {
  const rows = UUID_PATTERN.test(userIdOrEmail)
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, userIdOrEmail))
        .limit(1)
    : await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, userIdOrEmail))
        .limit(1);

  return rows[0] ?? null;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
