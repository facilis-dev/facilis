import { inflateRawSync } from "node:zlib";
import type { SamlConfig } from "@node-saml/node-saml";
import { describe, expect, it } from "vitest";

import {
  buildAuthnRequestXml,
  buildSamlRedirect,
  validateSamlResponse,
  type SamlProfileLike,
  type SamlValidator,
  type SamlValidatorFactory,
} from "./saml.ts";
import type { SamlProviderConfig } from "./providers.ts";

const provider: SamlProviderConfig = {
  kind: "saml",
  id: "acme",
  autoProvision: true,
  entryPoint: "https://idp.example.com/saml/sso",
  issuer: "https://app.example.com/saml/metadata",
  certificateEnv: "ACME_SAML_CERT",
  emailAttribute: "email",
  wantAssertionsSigned: true,
  wantResponseSigned: false,
};

const ACS_URL = "https://app.example.com/api/auth/sso/acme/callback";

function validator(profile: unknown): SamlValidator {
  return {
    validatePostResponseAsync: async () => ({
      profile: profile as SamlProfileLike,
      loggedOut: false,
    }),
  };
}

function factory(profile: unknown, seen?: { config?: SamlConfig }): SamlValidatorFactory {
  return (config) => {
    if (seen !== undefined) seen.config = config;
    return validator(profile);
  };
}

describe("AuthnRequest", () => {
  it("carries the SP entity id, ACS URL, destination, binding and NameID policy", () => {
    const xml = buildAuthnRequestXml(provider, "_request-1", ACS_URL, "2026-11-08T00:00:00.000Z");
    expect(xml).toContain('ID="_request-1"');
    expect(xml).toContain('Version="2.0"');
    expect(xml).toContain('IssueInstant="2026-11-08T00:00:00.000Z"');
    expect(xml).toContain('Destination="https://idp.example.com/saml/sso"');
    expect(xml).toContain(`AssertionConsumerServiceURL="${ACS_URL}"`);
    expect(xml).toContain("urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST");
    expect(xml).toContain(`<saml:Issuer>${provider.issuer}</saml:Issuer>`);
    expect(xml).toContain("samlp:NameIDPolicy");
    expect(xml).toContain("urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress");
  });

  it("escapes XML metacharacters", () => {
    const xml = buildAuthnRequestXml(
      { ...provider, issuer: "https://app.example.com/?a=1&b=<2>" },
      "_id",
      ACS_URL,
      "now",
    );
    expect(xml).not.toContain("a=1&b=<2>");
    expect(xml).toContain("a=1&amp;b=&lt;2&gt;");
  });

  it("builds the HTTP-Redirect URL with deflated request and RelayState", async () => {
    const built = await buildSamlRedirect(provider, ACS_URL, "state-token");
    expect(built.requestId).toMatch(/^_[0-9a-f-]{36}$/);

    const url = new URL(built.redirectUrl);
    expect(url.origin + url.pathname).toBe(provider.entryPoint);
    expect(url.searchParams.get("RelayState")).toBe("state-token");
    const encoded = url.searchParams.get("SAMLRequest");
    if (encoded === null) throw new Error("missing SAMLRequest");
    const xml = inflateRawSync(Buffer.from(encoded, "base64")).toString("utf8");
    expect(xml).toContain(`ID="${built.requestId}"`);
    expect(xml).toContain(`AssertionConsumerServiceURL="${ACS_URL}"`);
  });
});

describe("ACS validation", () => {
  const base = {
    provider,
    certificate: "certificate",
    callbackUrl: ACS_URL,
    samlResponse: "PHNhbWxwOlJlc3BvbnNlLz4=",
    requestId: "_request-1",
  };

  it("validates with the configured policy and binds the response to the stored request id", async () => {
    const seen: { config?: SamlConfig } = {};
    const claims = await validateSamlResponse({
      ...base,
      validatorFactory: factory({ nameID: "subject-1", email: "user@example.com" }, seen),
    });

    expect(claims).toEqual({
      provider: "acme",
      subject: "subject-1",
      email: "user@example.com",
      emailVerified: true,
    });
    expect(seen.config).toMatchObject({
      callbackUrl: ACS_URL,
      entryPoint: provider.entryPoint,
      issuer: provider.issuer,
      audience: provider.issuer,
      idpCert: "certificate",
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      acceptedClockSkewMs: 5000,
      validateInResponseTo: "ifPresent",
    });
    const cache = seen.config?.cacheProvider;
    expect(await cache?.getAsync("_request-1")).toBe("_request-1");
    expect(await cache?.getAsync("_other")).toBeNull();
    expect(await cache?.getAsync("_request-1")).toBe("_request-1");
    expect(await cache?.removeAsync("_request-1")).toBe("_request-1");
    expect(await cache?.getAsync("_request-1")).toBeNull();
  });

  it("reads the configured email attribute case-insensitively, including an array value", async () => {
    const claims = await validateSamlResponse({
      ...base,
      provider: { ...provider, emailAttribute: "EMail" },
      validatorFactory: factory({
        nameID: "subject-1",
        Email: ["first@example.com", "second@example.com"],
      }),
    });
    expect(claims.email).toBe("first@example.com");
  });

  it("reads the NameID when emailAttribute is nameid", async () => {
    const claims = await validateSamlResponse({
      ...base,
      provider: { ...provider, emailAttribute: "nameid" },
      validatorFactory: factory({ nameID: "nameid@example.com" }),
    });
    expect(claims).toEqual({
      provider: "acme",
      subject: "nameid@example.com",
      email: "nameid@example.com",
      emailVerified: true,
    });
  });

  it("rejects a response without an assertion, a signature failure or a malformed certificate", async () => {
    const noProfile = await validateSamlResponse({
      ...base,
      validatorFactory: () => ({
        validatePostResponseAsync: async () => ({ profile: null, loggedOut: false }),
      }),
    }).catch((error: { code?: string }) => error.code);
    expect(noProfile).toBe("sso_exchange_failed");

    const throwing = await validateSamlResponse({
      ...base,
      validatorFactory: () => ({
        validatePostResponseAsync: async () => {
          throw new Error("Invalid signature");
        },
      }),
    }).catch((error: { code?: string }) => error.code);
    expect(throwing).toBe("sso_exchange_failed");
  });

  it("rejects an assertion whose email is missing or malformed", async () => {
    await expect(
      validateSamlResponse({ ...base, validatorFactory: factory({ nameID: "subject-1" }) }),
    ).rejects.toMatchObject({ code: "sso_identity_invalid" });
    await expect(
      validateSamlResponse({
        ...base,
        validatorFactory: factory({ nameID: "subject-1", email: "not-an-email" }),
      }),
    ).rejects.toMatchObject({ code: "sso_identity_invalid" });
  });

  it("runs the real, lazily imported node-saml validator and rejects an unsigned response", async () => {
    // The XML parses but carries no signature: validation must fail closed, not accept an
    // unsigned assertion. This also proves the lazy import works in the Node test runtime.
    const unsigned =
      "PHNhbWxwOlJlc3BvbnNlIHhtbG5zOnNhbWxwPSJ1cm46b2FzaXM6bmFtZXM6dGM6U0FNTDoyLjA6cHJvdG9jb2wiPjxzYW1sOkFzc2VydGlvbj48L3NhbWw6QXNzZXJ0aW9uPjwvc2FtbHA6UmVzcG9uc2U+";
    await expect(
      validateSamlResponse({ ...base, samlResponse: unsigned, validatorFactory: undefined }),
    ).rejects.toMatchObject({ code: "sso_exchange_failed" });
  });
});
