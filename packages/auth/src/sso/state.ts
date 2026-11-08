import { eq, lt } from "drizzle-orm";

import { randomToken } from "../crypto.ts";
import type { SystemRunner } from "./contracts.ts";
import { SsoError } from "./errors.ts";
import { authSsoStates, type AuthSsoStateRow } from "./tables.ts";

/** Contract cap on the post-login path (same-origin only; D-120). */
export const MAX_REDIRECT_TO = 2048;
const STATE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;
const STATE_TABLES = ["auth_sso_states"] as const;

/**
 * Validates a post-login redirect: a same-origin absolute path only.
 *
 * Rejecting `//host`, a backslash and control characters closes the open-redirect hole: the value
 * becomes the `Location` of a 302 and the user must never leave the application origin.
 */
export function normalizeRedirectTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REDIRECT_TO)
    return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  // Whitespace and control characters have no business in an origin-relative path; browsers
  // trim some of them, so refuse instead of relying on normalisation.
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return value;
}

export interface CreateSsoStateInput {
  /** Explicit token (SAML builds the AuthnRequest, whose RelayState is the state, before insert). */
  readonly state?: string;
  readonly provider: string;
  /** `auth.sso.stateTtlMs`. */
  readonly ttlMs: number;
  readonly redirectTo: string | null;
  readonly nonce?: string;
  readonly codeVerifier?: string;
  readonly requestId?: string;
}

function stateElevation(operation: string) {
  return {
    actor: "system:auth:sso" as const,
    operation,
    reason: "The SSO login attempt is framework-owned state written before a session exists.",
    tables: STATE_TABLES,
  };
}

/**
 * Creates one single-use state row (32 random bytes, base64url) inside the audited system
 * elevation. Expired rows are pruned on the same write, so a start request also cleans up.
 */
export async function createSsoState(
  system: SystemRunner,
  input: CreateSsoStateInput,
  now: number = Date.now(),
): Promise<AuthSsoStateRow> {
  const state = input.state ?? randomToken(32);
  if (!STATE_TOKEN_PATTERN.test(state)) throw new SsoError("sso_internal_error", "bad state token");
  const createdAt = new Date(now);
  const expiresAt = new Date(now + input.ttlMs);

  const row = await system(stateElevation("auth:sso:state:create"), async (db) => {
    await db.delete(authSsoStates).where(lt(authSsoStates.expiresAt, createdAt));
    const inserted = await db
      .insert(authSsoStates)
      .values({
        state,
        provider: input.provider,
        nonce: input.nonce ?? null,
        codeVerifier: input.codeVerifier ?? null,
        requestId: input.requestId ?? null,
        redirectTo: input.redirectTo,
        createdAt,
        expiresAt,
      })
      .returning();
    return inserted[0] ?? null;
  });

  if (row === null) throw new SsoError("sso_internal_error");
  return row;
}

/**
 * Consumes a state row atomically (`DELETE ... RETURNING`) and returns it once.
 *
 * A missing row (already used, unknown, or never issued) and an expired row are both
 * `sso_state_invalid`: the caller only learns "this attempt is not valid".
 */
export async function consumeSsoState(
  system: SystemRunner,
  state: string,
  now: number = Date.now(),
): Promise<AuthSsoStateRow> {
  if (!STATE_TOKEN_PATTERN.test(state)) throw new SsoError("sso_state_invalid");

  const row = await system(stateElevation("auth:sso:state:consume"), async (db) => {
    const deleted = await db
      .delete(authSsoStates)
      .where(eq(authSsoStates.state, state))
      .returning();
    return deleted[0] ?? null;
  });

  if (row === null) throw new SsoError("sso_state_invalid");
  if (row.expiresAt.getTime() <= now) throw new SsoError("sso_state_invalid");
  return row;
}
