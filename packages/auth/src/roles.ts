/**
 * Auth context attached to requests once a session is validated (contract §4.1/§6).
 *
 * It deliberately carries no tenant (D-040): the tenant is the deployment's, resolved from
 * FACILIS_TENANT_ID for every request, so a session can neither widen nor change the RLS scope.
 */
export interface AuthContext {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

/** Shape of `facilis.config.ts`'s `auth` block that @facilis/auth needs. */
export interface AuthConfig {
  readonly permissions: readonly string[];
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly defaultRole: string;
  readonly sessionDurationMs: number;
}

const WILDCARD = "*";

/**
 * Expands app roles into concrete permissions, deterministically: roles keep their input
 * order, permissions keep config order, duplicates collapse to the first occurrence.
 * Unknown roles (e.g. a stale `user_roles` row) contribute nothing.
 */
export function expandRoles(roles: readonly string[], config: AuthConfig): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();

  const add = (permission: string): void => {
    if (seen.has(permission)) return;
    seen.add(permission);
    expanded.push(permission);
  };

  for (const role of roles) {
    const declared = config.roles[role];
    if (declared === undefined) continue;
    for (const permission of declared) {
      if (permission === WILDCARD) {
        for (const granted of config.permissions) add(granted);
      } else {
        add(permission);
      }
    }
  }

  return expanded;
}

/**
 * Route RBAC check (contract §4.4): `[]` requires nothing (public route), a non-empty
 * list requires at least one match, and null means no session. A literal "*" permission
 * on the subject grants everything as a safety net for hand-built contexts.
 */
export function hasPermission(
  subject: Pick<AuthContext, "permissions"> | null,
  permission: string | readonly string[],
): boolean {
  const required = typeof permission === "string" ? [permission] : permission;
  if (required.length === 0) return true;
  if (subject === null) return false;
  if (subject.permissions.includes(WILDCARD)) return true;
  return required.some((candidate) => subject.permissions.includes(candidate));
}
