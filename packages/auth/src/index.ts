/**
 * @facilis/auth — session and RBAC primitives.
 *
 * Phase 0 skeleton: `hasPermission` is the pure RBAC check used by
 * `defineAuthorizedHandler`. Role expansion from `facilis.config.ts` and the session
 * middleware arrive in Phase 2.
 */

export interface AuthContext {
  userId: string;
  tenantId: string;
  roles: readonly string[];
  permissions: readonly string[];
}

export interface PermissionSubject {
  roles: readonly string[];
  permissions: readonly string[];
}

export function hasPermission(subject: PermissionSubject | null, permission: string): boolean {
  if (subject === null) return false;

  return subject.permissions.includes(permission) || subject.permissions.includes("*");
}
