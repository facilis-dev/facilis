/**
 * @facilis/auth — auth tables, RBAC expansion, password hashing, sessions and seeding.
 */

export {
  apiClients,
  apiTokens,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
  type ApiClientRow,
  type ApiTokenRow,
  type AuthUser,
  type NewUserRow,
  type RolePermissionRow,
  type RoleRow,
  type SessionRow,
  type UserRoleRow,
  type UserRow,
} from "./tables.ts";
export {
  createApiClient,
  issueApiToken,
  listApiClients,
  revokeApiClient,
  validateApiToken,
  type ApiClientSummary,
  type CreateApiClientInput,
  type CreatedApiClient,
  type IssuedApiToken,
  type IssueApiTokenInput,
  type ValidatedApiToken,
} from "./api-clients.ts";
export { normalizeEmail } from "./email.ts";
export { expandRoles, hasPermission, type AuthConfig, type AuthContext } from "./roles.ts";
export { hashPassword, verifyPassword } from "./password.ts";
export {
  createSession,
  destroySession,
  SESSION_COOKIE_NAME,
  sessionMiddleware,
  validateSession,
  type CreateSessionOptions,
  type SessionEvent,
  type SessionEventContext,
  type SessionMiddlewareDeps,
  type ValidatedSession,
} from "./session.ts";
export { registerInitialAdmin, seedFromConfig, seedStatements, type SeedEntry } from "./seed.ts";
export * from "./sso/index.ts";
