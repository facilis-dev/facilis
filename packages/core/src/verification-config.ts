import { z } from "zod";

/**
 * Email verification for password accounts (D-156).
 *
 * Opt-in: a project that omits `auth.verification` keeps the pre-D-156 behavior (registration
 * creates the account; login does not look at `users.email_verified_at`). Delivering the email is
 * a DEPLOYMENT concern, exactly like the log sink and the storage credentials: the webhook URL and
 * token live in the environment (FACILIS_EMAIL_WEBHOOK_URL / FACILIS_EMAIL_WEBHOOK_TOKEN), never in
 * a committed config. The blueprint ships a dev fallback (log the link) and a webhook sender.
 */
const DEFAULT_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;
const MAX_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const redirectPath = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"),
    "must be a same-origin path such as /login",
  );

export interface FacilisEmailVerificationConfig {
  /** Require a verified email before the blueprint login starts a session. */
  readonly enabled: boolean;
  /** Lifetime of a verification link; default 24 h, capped at 30 days. */
  readonly tokenTtlMs: number;
  /** Same-origin path the link redirects to on success; `?verified=1` is appended. */
  readonly successRedirect: string;
  /** Same-origin path on failure; `?verify_error=<code>` is appended. */
  readonly failureRedirect: string;
}

export type FacilisEmailVerificationConfigInput = Partial<FacilisEmailVerificationConfig>;

/** Defaults a project gets without declaring the section: verification off (no behavior change). */
export const DEFAULT_EMAIL_VERIFICATION_CONFIG: FacilisEmailVerificationConfig = {
  enabled: false,
  tokenTtlMs: DEFAULT_TOKEN_TTL_MS,
  successRedirect: "/login",
  failureRedirect: "/login",
};

export const facilisEmailVerificationConfigSchema: z.ZodType<FacilisEmailVerificationConfig> = z
  .strictObject({
    enabled: z.boolean().default(false),
    tokenTtlMs: z.number().int().positive().max(MAX_TOKEN_TTL_MS).default(DEFAULT_TOKEN_TTL_MS),
    successRedirect: redirectPath.default("/login"),
    failureRedirect: redirectPath.default("/login"),
  })
  .default(() => ({ ...DEFAULT_EMAIL_VERIFICATION_CONFIG }));
