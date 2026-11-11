import { eq, sql } from "drizzle-orm";

import type { PolicyScopedDatabase } from "@facilis.dev/db";

import { constantTimeEqual, sha256Hex } from "./crypto.ts";
import { normalizeEmail } from "./email.ts";
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
 *
 * The email alone is not a credential: it is public and the registration route is public, so
 * the promotion ALSO requires the operator's one-time FACILIS_INITIAL_ADMIN_TOKEN (D-150).
 * Both variables must be set; a missing token fails closed, the token is compared in constant
 * time, and the promotion happens only while no admin exists yet, so a deploy that keeps the
 * token configured after bootstrap cannot be re-triggered. Accepts a user id or email; returns
 * false when any condition fails.
 */
export async function registerInitialAdmin(
  db: PolicyScopedDatabase,
  userIdOrEmail: string,
  bootstrapToken?: string,
): Promise<boolean> {
  const expected = readInitialAdminEmail();
  if (expected === null) return false;
  const expectedToken = readInitialAdminToken();
  if (expectedToken === null || bootstrapToken === undefined) return false;
  if (!(await tokenMatches(bootstrapToken, expectedToken))) return false;
  // One-time: an admin already assigned means bootstrap is over, even if the env stays set.
  if (await hasAdmin(db)) return false;

  const user = await findUser(db, userIdOrEmail.trim());
  if (user === null) return false;
  // Emails compare in canonical form: a case variant of the configured address is not the
  // configured address (the unique lower(email) index makes the two the same account, D-150).
  if (normalizeEmail(user.email) !== expected) return false;

  await db
    .insert(userRoles)
    .values({ userId: user.id, role: INITIAL_ADMIN_ROLE })
    .onConflictDoNothing();
  return true;
}

function readInitialAdminEmail(): string | null {
  const configured = process.env.FACILIS_INITIAL_ADMIN?.trim();
  return configured === undefined || configured.length === 0 ? null : normalizeEmail(configured);
}

function readInitialAdminToken(): string | null {
  const configured = process.env.FACILIS_INITIAL_ADMIN_TOKEN?.trim();
  return configured === undefined || configured.length === 0 ? null : configured;
}

/**
 * Hash-then-compare keeps the comparison independent of the two input lengths, so a wrong
 * token leaks neither its length nor the index of the first wrong character.
 */
async function tokenMatches(provided: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256Hex(provided), sha256Hex(expected)]);
  return constantTimeEqual(new TextEncoder().encode(left), new TextEncoder().encode(right));
}

async function hasAdmin(db: PolicyScopedDatabase): Promise<boolean> {
  const rows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.role, INITIAL_ADMIN_ROLE))
    .limit(1);
  return rows.length > 0;
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
        .where(sql`lower(${users.email}) = ${normalizeEmail(userIdOrEmail)}`)
        .limit(1);

  return rows[0] ?? null;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
