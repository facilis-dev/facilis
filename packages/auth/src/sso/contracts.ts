import type { PolicyScopedDatabase } from "@facilis/db";

/**
 * Structural contracts shared by the SSO modules (D-120).
 *
 * @facilis/core depends on @facilis/auth (route.ts imports the RBAC helpers), so auth cannot
 * import core without a package cycle. A system elevation is therefore described structurally:
 * `ctx.system` from `defineAuthorizedHandler` satisfies {@link SystemRunner} without auth
 * owning a copy of the core type.
 */

/** What a system elevation must say about itself; all fields are audited (D-099). */
export interface SystemElevationOptions {
  readonly actor: `system:${string}`;
  readonly operation: string;
  readonly reason: string;
  /** Non-empty subset of the route's `dbTables`. */
  readonly tables: readonly string[];
}

/** The audited system elevation passed into the SSO flow: never a raw database client. */
export type SystemRunner = <T>(
  options: SystemElevationOptions,
  fn: (systemDb: PolicyScopedDatabase) => Promise<T>,
) => Promise<T>;

/** The identity an IdP asserts: the key, the email and whether that email is verified. */
export interface IdentityClaims {
  readonly provider: string;
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/** The audit input subset the SSO flow writes through `ctx.log.audit` (D-119). */
export interface SsoAuditInput {
  readonly operation: string;
  readonly outcome?: "succeeded" | "failed";
  readonly errorCode?: string;
  readonly reason?: string;
  readonly tables?: readonly string[];
  readonly details?: Record<string, unknown>;
}

/** A narrower audit sink: `ctx.log.audit` satisfies it structurally. */
export type SsoAudit = (input: SsoAuditInput) => void;

/** The subset of the Fetch API the OAuth/OIDC/OAuth2 HTTP calls need (no Node dependency). */
export interface FetchInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

/** The runtime fetch, narrowed to {@link FetchLike}; tests inject their own. */
export function runtimeFetch(): FetchLike {
  const candidate = (globalThis as unknown as { fetch?: unknown }).fetch;
  if (typeof candidate !== "function") {
    throw new Error("facilis: the runtime has no fetch implementation for SSO");
  }
  return candidate as FetchLike;
}
