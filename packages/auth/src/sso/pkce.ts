import { encodeBase64, randomToken, webcrypto } from "../crypto.ts";

/**
 * PKCE (RFC 7636) for the authorization-code flows (D-120).
 *
 * Both OIDC and generic OAuth2 use S256 unconditionally: a provider that does not implement PKCE
 * ignores the unknown parameters (RFC 6749), while a public `tokenAuth: "none"` client is
 * protected against authorization-code interception. Kept in its own module so the OIDC flow
 * and the login orchestration stay under the 300-line limit.
 */

function toBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function s256(verifier: string): Promise<string> {
  const digest = await webcrypto().subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

/** PKCE S256 pair: a 43-character base64url verifier and its SHA-256 challenge. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomToken(32);
  return { verifier, challenge: await s256(verifier) };
}
