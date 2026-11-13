import type { FrameworkModule } from "../framework-reference";

/**
 * `@facilis.dev/auth` — sessions, RBAC expansion and seeding (SPEC §5.3, §8.4.4).
 *
 * A project usually writes its own login/logout routes against these helpers; the session
 * middleware is mounted by the framework runtime.
 */
export const AUTH_MODULE: FrameworkModule = {
  id: "auth",
  package: "@facilis.dev/auth",
  summary:
    "Auth tables, AuthContext, role/permission checks, password hashing, sessions and the session middleware, admin bootstrap.",
  entries: [
    {
      name: "AuthContext",
      kind: "type",
      signature:
        'interface AuthContext { userId: string; roles: readonly string[]; permissions: readonly string[]; sessionHash?: string; via?: "session" | "bearer" }',
      summary:
        "The session context the wrapper attaches to ctx.auth: user id, app roles, expanded permissions and the credential channel; it carries no tenant (the deployment owns it).",
    },
    {
      name: "expandRoles",
      kind: "function",
      signature: "expandRoles(roles: readonly string[], config: AuthConfig): string[]",
      summary:
        "Expands app roles into concrete permissions in config order; unknown roles contribute nothing and a '*' permission inside a role grants every configured permission.",
    },
    {
      name: "hasPermission",
      kind: "function",
      signature:
        'hasPermission(subject: Pick<AuthContext, "permissions"> | null, permission: string | readonly string[]): boolean',
      summary:
        "Route RBAC check: [] means public, null (anonymous) fails any requirement, and a '*' permission on the subject grants everything.",
    },
    {
      name: "hashPassword",
      kind: "function",
      signature: "hashPassword(password: string): Promise<string>",
      summary:
        "PBKDF2-SHA256 (WebCrypto) with a versioned, self-describing encoding, so a login route never stores or compares plaintext.",
    },
    {
      name: "verifyPassword",
      kind: "function",
      signature: "verifyPassword(hash: string, password: string): Promise<boolean>",
      summary:
        "Constant-time password verification; a malformed or unsupported hash returns false and never throws.",
    },
    {
      name: "createSession",
      kind: "function",
      signature:
        "createSession(db: PolicyScopedDatabase, userId: string, options?: CreateSessionOptions): Promise<{ id: string; expiresAt: Date }>",
      summary:
        "Creates the opaque session row (the stored key is the SHA-256 of the cookie value); the login route then sets the cookie with @facilis.dev/nitro/session.",
    },
    {
      name: "sessionMiddleware",
      kind: "function",
      signature:
        "sessionMiddleware(deps: SessionMiddlewareDeps): (event: SessionEvent) => Promise<void>",
      summary:
        "Nitro server middleware: validates the session cookie (or a Bearer API token), loads roles inside the deployment-tenant policy scope and sets event.context.auth.",
    },
    {
      name: "registerInitialAdmin",
      kind: "function",
      signature:
        "registerInitialAdmin(db: PolicyScopedDatabase, userIdOrEmail: string, bootstrapToken?: string): Promise<boolean>",
      summary:
        "One-time admin bootstrap from FACILIS_INITIAL_ADMIN_EMAIL + FACILIS_INITIAL_ADMIN_TOKEN; false when the config is absent, the token is wrong, or an admin already exists.",
    },
    {
      name: "seedFromConfig",
      kind: "function",
      signature: "seedFromConfig(config: AuthConfig): SeedEntry[]",
      summary:
        "Pure projection of config.auth.roles into roles/role_permissions rows, written only by the migration step (app code never writes role_permissions).",
    },
  ],
};
