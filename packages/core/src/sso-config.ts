import { z } from "zod";

/**
 * The `auth.sso` section of facilis.config.ts (SPEC §5.3, D-120).
 *
 * SSO is configuration-in-code like the rest of auth: providers, endpoints and the ENV VAR
 * NAMES that hold secrets are committed and reviewable; the secret values never appear in
 * the project. `defineConfig` validates the shape eagerly so a broken provider fails at boot
 * instead of on the first login attempt. The protocol implementation lives in @facilis.dev/auth.
 */

export const SSO_PROVIDER_KINDS = ["oidc", "oauth2", "saml"] as const;
export type SsoProviderKind = (typeof SSO_PROVIDER_KINDS)[number];

const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

function httpUrl(label: string): z.ZodString {
  return z
    .string()
    .min(1)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    }, `${label} must be an absolute http(s) URL`);
}

const providerId = z
  .string()
  .regex(PROVIDER_ID, "provider id must match ^[a-z0-9][a-z0-9_-]{0,31}$");

const secretEnv = z.string().regex(ENV_NAME, "environment variable names must be UPPER_SNAKE_CASE");

const redirectPath = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"),
    "must be a same-origin path such as /login",
  );

const providerBase = {
  /** Stable slug used in the callback URL; never change it once the IdP knows the URL. */
  id: providerId,
  /** Shown on the login page; defaults to the id. */
  label: z.string().min(1).max(64).optional(),
  /** Create a user for an unknown identity (otherwise only existing users may sign in). */
  autoProvision: z.boolean().default(true),
  /** Role assigned to a provisioned user; defaults to auth.defaultRole. */
  defaultRole: z.string().min(1).optional(),
};

const oidcProviderSchema = z.strictObject({
  kind: z.literal("oidc"),
  ...providerBase,
  /** Issuer URL: discovery is `${issuer}/.well-known/openid-configuration`. */
  issuer: httpUrl("issuer"),
  clientId: z.string().min(1),
  /** ENV var holding the client secret; omit for a public PKCE client. */
  clientSecretEnv: secretEnv.optional(),
  scopes: z.array(z.string().min(1)).min(1).readonly().default(["openid", "email", "profile"]),
  tokenAuth: z
    .enum(["client_secret_post", "client_secret_basic", "none"])
    .default("client_secret_post"),
  /** Accept an IdP that does not report `email_verified` (internal/trusted issuers only). */
  assumeEmailVerified: z.boolean().default(false),
});

const oauth2ProviderSchema = z.strictObject({
  kind: z.literal("oauth2"),
  ...providerBase,
  authorizationEndpoint: httpUrl("authorizationEndpoint"),
  tokenEndpoint: httpUrl("tokenEndpoint"),
  userinfoEndpoint: httpUrl("userinfoEndpoint"),
  clientId: z.string().min(1),
  clientSecretEnv: secretEnv.optional(),
  scopes: z.array(z.string().min(1)).readonly().default([]),
  tokenAuth: z
    .enum(["client_secret_post", "client_secret_basic", "none"])
    .default("client_secret_post"),
  /** Where the userinfo JSON carries the subject, the email and its verified flag. */
  mapping: z.strictObject({
    subject: z.string().min(1),
    email: z.string().min(1),
    emailVerified: z.string().min(1).optional(),
  }),
  /** Accept a provider that never reports email_verified (e.g. a trusted internal IdP). */
  assumeEmailVerified: z.boolean().default(false),
});

const samlProviderSchema = z.strictObject({
  kind: z.literal("saml"),
  ...providerBase,
  /** IdP SSO endpoint (HTTP-Redirect binding). */
  entryPoint: httpUrl("entryPoint"),
  /** SP entity id declared to the IdP; also the expected assertion audience. */
  issuer: z.string().min(1),
  /** ENV var holding the IdP signing certificate (PEM or base64 DER). */
  certificateEnv: secretEnv,
  /** Assertion attribute (or NameID when "nameid") carrying the email address. */
  emailAttribute: z.string().min(1).default("email"),
  /** Require the assertion element to be signed (default: yes). */
  wantAssertionsSigned: z.boolean().default(true),
  /** Require the whole Response element to be signed (default: no, the assertion is enough). */
  wantResponseSigned: z.boolean().default(false),
});

export const ssoProviderSchema = z.discriminatedUnion("kind", [
  oidcProviderSchema,
  oauth2ProviderSchema,
  samlProviderSchema,
]);

export const ssoConfigSchema = z
  .strictObject({
    providers: z.array(ssoProviderSchema).max(20).readonly().default([]),
    /** Where a failed callback sends the browser; `?sso_error=<code>` is appended. */
    failureRedirect: redirectPath.default("/login"),
    /** Lifetime of a login attempt (state/nonce/PKCE/request id); default ten minutes. */
    stateTtlMs: z
      .number()
      .int()
      .positive()
      .max(60 * 60 * 1000)
      .default(10 * 60 * 1000),
  })
  .default(() => DEFAULT_SSO_CONFIG);

export type FacilisSsoProvider = z.infer<typeof ssoProviderSchema>;
export type FacilisSsoConfig = z.infer<typeof ssoConfigSchema>;
export type FacilisSsoConfigInput = z.input<typeof ssoConfigSchema>;

export const DEFAULT_SSO_CONFIG: FacilisSsoConfig = {
  providers: [],
  failureRedirect: "/login",
  stateTtlMs: 10 * 60 * 1000,
};

export interface SsoValidationContext {
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly defaultRole: string;
}

/**
 * Cross-section checks the per-provider schema cannot express: ids are unique URL segments
 * and every defaultRole names a role declared in `auth.roles` (SPEC §8.4.1).
 */
export function checkSsoConfig(
  sso: FacilisSsoConfig,
  auth: SsoValidationContext,
  ctx: z.RefinementCtx,
  path: readonly (string | number)[] = ["auth", "sso"],
): void {
  const seen = new Set<string>();
  for (const [index, provider] of sso.providers.entries()) {
    const providerPath = [...path, "providers", index];
    if (seen.has(provider.id)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate SSO provider id "${provider.id}"`,
        path: [...providerPath, "id"],
      });
    }
    seen.add(provider.id);
    const role = provider.defaultRole;
    if (role !== undefined && !Object.hasOwn(auth.roles, role)) {
      ctx.addIssue({
        code: "custom",
        message: `SSO provider "${provider.id}" defaultRole "${role}" is not a key of auth.roles`,
        path: [...providerPath, "defaultRole"],
      });
    }
    const confidential = provider.kind !== "saml" && provider.tokenAuth !== "none";
    if (confidential && provider.clientSecretEnv === undefined) {
      ctx.addIssue({
        code: "custom",
        message: `SSO provider "${provider.id}" needs clientSecretEnv unless tokenAuth is "none"`,
        path: [...providerPath, "clientSecretEnv"],
      });
    }
  }
}
