import type { CacheItem, CacheProvider, SamlConfig } from "@node-saml/node-saml";

import { encodeBase64 } from "../crypto.ts";
import type { IdentityClaims } from "./contracts.ts";
import { SsoError } from "./errors.ts";
import type { SamlProviderConfig } from "./providers.ts";

/**
 * SAML 2.0 SP-initiated Web Browser SSO (D-120).
 *
 * The AuthnRequest is built here (HTTP-Redirect, DEFLATE+base64) so the framework owns the
 * request id, the ACS URL and the RelayState. ACS validation is delegated to
 * `@node-saml/node-saml`, imported LAZILY inside this path: a project without SAML never loads
 * (or bundles) its CJS crypto tree. IdP-initiated assertions are not accepted: there is no
 * unsolicited-response surface, and the single-use RelayState is mandatory.
 */

const CLOCK_SKEW_MS = 5000;
const NAME_ID_FORMAT = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";
const PROTOCOL_BINDING_POST = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export interface BuiltSamlRequest {
  readonly requestId: string;
  readonly redirectUrl: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** The AuthnRequest XML (exported for tests; the IdP only ever sees the DEFLATE+base64 form). */
export function buildAuthnRequestXml(
  provider: SamlProviderConfig,
  requestId: string,
  acsUrl: string,
  issueInstant: string,
): string {
  return (
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
    `xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${escapeXml(requestId)}" ` +
    `Version="2.0" IssueInstant="${issueInstant}" Destination="${escapeXml(provider.entryPoint)}" ` +
    `AssertionConsumerServiceURL="${escapeXml(acsUrl)}" ProtocolBinding="${PROTOCOL_BINDING_POST}">` +
    `<saml:Issuer>${escapeXml(provider.issuer)}</saml:Issuer>` +
    `<samlp:NameIDPolicy AllowCreate="true" Format="${NAME_ID_FORMAT}"/>` +
    `</samlp:AuthnRequest>`
  );
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  // node:zlib is a server-only builtin and is loaded with the SAML path, never at module load.
  const { deflateRawSync } = await import("node:zlib");
  return new Uint8Array(deflateRawSync(bytes));
}

/** Builds the HTTP-Redirect URL carrying the deflated AuthnRequest and the RelayState. */
export async function buildSamlRedirect(
  provider: SamlProviderConfig,
  acsUrl: string,
  relayState: string,
  now: number = Date.now(),
): Promise<BuiltSamlRequest> {
  const requestId = `_${globalThis.crypto.randomUUID()}`;
  const xml = buildAuthnRequestXml(provider, requestId, acsUrl, new Date(now).toISOString());
  const compressed = await deflateRaw(new TextEncoder().encode(xml));
  const url = new URL(provider.entryPoint);
  url.searchParams.set("SAMLRequest", encodeBase64(compressed));
  url.searchParams.set("RelayState", relayState);
  return { requestId, redirectUrl: url.toString() };
}

export interface SamlProfileLike {
  readonly nameID?: unknown;
  readonly issuer?: unknown;
  [attribute: string]: unknown;
}

export interface SamlValidator {
  validatePostResponseAsync(
    container: Record<string, string>,
  ): Promise<{ profile: SamlProfileLike | null; loggedOut: boolean }>;
}

export type SamlValidatorFactory = (config: SamlConfig) => SamlValidator | Promise<SamlValidator>;

/**
 * A cache provider whose only entry is the request id of THIS attempt.
 *
 * `validateInResponseTo: "always"` (D-147) requires the response to carry the InResponseTo of the
 * AuthnRequest this framework issued and to match the single-use state row; a response without
 * it (IdP-initiated / unsolicited, or a replayed assertion) is rejected by node-saml.
 */
function singleUseRequestCache(requestId: string | null): CacheProvider {
  let remaining = requestId;
  const take = async (key: string | null): Promise<string | null> => {
    if (key === null || remaining === null || key !== remaining) return null;
    const value = remaining;
    remaining = null;
    return value;
  };
  return {
    async saveAsync(): Promise<CacheItem | null> {
      return null;
    },
    async getAsync(key: string): Promise<string | null> {
      return key === remaining ? remaining : null;
    },
    async removeAsync(key: string | null): Promise<string | null> {
      return take(key);
    },
    async consumeAsync(key: string): Promise<string | null> {
      return take(key);
    },
    async saveIfAbsentAsync(): Promise<boolean> {
      return false;
    },
  };
}

function toSamlConfig(
  provider: SamlProviderConfig,
  certificate: string,
  callbackUrl: string,
  requestId: string | null,
): SamlConfig {
  return {
    callbackUrl,
    entryPoint: provider.entryPoint,
    issuer: provider.issuer,
    audience: provider.issuer,
    idpCert: certificate,
    wantAssertionsSigned: provider.wantAssertionsSigned,
    wantAuthnResponseSigned: provider.wantResponseSigned,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    // The library's enum is a runtime value; the string literal is the same member.
    validateInResponseTo: "always" as SamlConfig["validateInResponseTo"],
    cacheProvider: singleUseRequestCache(requestId),
  };
}

async function defaultSamlFactory(config: SamlConfig): Promise<SamlValidator> {
  const { SAML } = await import("@node-saml/node-saml");
  return new SAML(config) as unknown as SamlValidator;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string" && entry.length > 0);
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

/** Case-insensitive attribute lookup; `nameid` means the NameID itself. */
function readAttribute(profile: SamlProfileLike, attribute: string): string | undefined {
  const wanted = attribute.toLowerCase();
  if (wanted === "nameid") return asString(profile.nameID);
  for (const [key, value] of Object.entries(profile)) {
    if (key.toLowerCase() !== wanted) continue;
    const found = asString(value);
    if (found !== undefined) return found;
  }
  for (const fallback of ["email", "mail", "emailaddress"]) {
    const found = asString(profile[fallback]);
    if (found !== undefined) return found;
  }
  return undefined;
}

export interface ValidateSamlInput {
  readonly provider: SamlProviderConfig;
  /** The IdP signing certificate (PEM or base64 DER). Never logged. */
  readonly certificate: string;
  readonly callbackUrl: string;
  /** The base64 `SAMLResponse` form field. */
  readonly samlResponse: string;
  /** The AuthnRequest id stored in the consumed state row. */
  readonly requestId: string | null;
  /** Test seam: replace the lazily imported validator. */
  readonly validatorFactory?: SamlValidatorFactory;
}

/**
 * Validates an ACS POST and returns the asserted identity.
 *
 * Signature, recipient, audience and time-window checks are node-saml's; a rejected response
 * (unsigned, tampered, wrong recipient/audience, expired) becomes `sso_exchange_failed`, never
 * a library message. A signed assertion is the IdP asserting the email, so SAML has no separate
 * `email_verified` flag and treats the address as verified.
 */
export async function validateSamlResponse(input: ValidateSamlInput): Promise<IdentityClaims> {
  const config = toSamlConfig(
    input.provider,
    input.certificate,
    input.callbackUrl,
    input.requestId,
  );
  const factory = input.validatorFactory ?? defaultSamlFactory;
  let result: Awaited<ReturnType<SamlValidator["validatePostResponseAsync"]>>;
  try {
    const validator = await factory(config);
    result = await validator.validatePostResponseAsync({ SAMLResponse: input.samlResponse });
  } catch (error) {
    throw new SsoError("sso_exchange_failed", "SAML response rejected", { cause: error });
  }
  if (result.profile === null || result.loggedOut) {
    throw new SsoError("sso_exchange_failed", "SAML response has no assertion");
  }
  const profile = result.profile;
  const email = readAttribute(profile, input.provider.emailAttribute);
  if (email === undefined || !EMAIL_PATTERN.test(email)) {
    throw new SsoError("sso_identity_invalid", "SAML assertion has no email");
  }
  const subject = asString(profile.nameID) ?? email;
  return { provider: input.provider.id, subject, email, emailVerified: true };
}
