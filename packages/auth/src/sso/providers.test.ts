import { describe, expect, it } from "vitest";

import { isSsoError } from "./errors.ts";
import {
  isProviderConfigured,
  missingCredentialEnv,
  publicProviderList,
  resolveProvider,
  type SsoConfigLike,
  type SsoProviderConfig,
} from "./providers.ts";

const OIDC: SsoProviderConfig = {
  kind: "oidc",
  id: "corp",
  label: "Corp SSO",
  autoProvision: true,
  issuer: "https://idp.example.com",
  clientId: "client-1",
  clientSecretEnv: "CORP_OIDC_SECRET",
  scopes: ["openid", "email", "profile"],
  tokenAuth: "client_secret_post",
  assumeEmailVerified: false,
};

const PUBLIC_OIDC: SsoProviderConfig = {
  ...OIDC,
  id: "public",
  label: undefined,
  clientSecretEnv: undefined,
  tokenAuth: "none",
};

const SAML: SsoProviderConfig = {
  kind: "saml",
  id: "acme",
  autoProvision: false,
  entryPoint: "https://idp.example.com/saml/sso",
  issuer: "https://app.example.com/saml/metadata",
  certificateEnv: "ACME_SAML_CERT",
  emailAttribute: "email",
  wantAssertionsSigned: true,
  wantResponseSigned: false,
};

function config(providers: SsoProviderConfig[]): SsoConfigLike {
  return { providers, failureRedirect: "/login", stateTtlMs: 600_000 };
}

describe("publicProviderList", () => {
  it("lists configured providers with framework start URLs and hides unconfigured ones", () => {
    const providers = publicProviderList(config([OIDC, PUBLIC_OIDC, SAML]), {
      CORP_OIDC_SECRET: "s3cret",
    });

    expect(providers).toEqual([
      { id: "corp", label: "Corp SSO", kind: "oidc", startUrl: "/api/auth/sso/corp/start" },
      { id: "public", label: "public", kind: "oidc", startUrl: "/api/auth/sso/public/start" },
    ]);
    // The list never carries a secret, a client id or an endpoint.
    expect(JSON.stringify(providers)).not.toContain("s3cret");
    expect(JSON.stringify(providers)).not.toContain("client-1");
  });

  it("treats an empty environment value as missing", () => {
    expect(publicProviderList(config([OIDC]), { CORP_OIDC_SECRET: "   " })).toEqual([]);
  });

  it("returns an empty list for a project without providers", () => {
    expect(publicProviderList(config([]), {})).toEqual([]);
  });
});

describe("resolveProvider", () => {
  it("reads the secret named by the environment variable", () => {
    const resolved = resolveProvider(config([OIDC]), "corp", { CORP_OIDC_SECRET: "s3cret" });
    expect(resolved.clientSecret).toBe("s3cret");
    expect(resolved.idpCertificate).toBeUndefined();
  });

  it("needs no secret for a public-client token auth", () => {
    expect(isProviderConfigured(PUBLIC_OIDC, {})).toBe(true);
    expect(resolveProvider(config([PUBLIC_OIDC]), "public", {}).clientSecret).toBeUndefined();
  });

  it("reads the SAML certificate from its environment variable", () => {
    const resolved = resolveProvider(config([SAML]), "acme", { ACME_SAML_CERT: "CERT" });
    expect(resolved.idpCertificate).toBe("CERT");
  });

  it("answers sso_provider_unknown for an unknown id", () => {
    try {
      resolveProvider(config([OIDC]), "nope", { CORP_OIDC_SECRET: "x" });
      throw new Error("expected resolveProvider to throw");
    } catch (error) {
      expect(isSsoError(error) && error.code).toBe("sso_provider_unknown");
    }
  });

  it("answers sso_provider_unavailable when the secret/certificate is missing", () => {
    for (const [configValue, env] of [
      [config([OIDC]), {}],
      [config([SAML]), {}],
    ] as const) {
      expect(() => resolveProvider(configValue, configValue.providers[0]?.id ?? "", env)).toThrow(
        /sso_provider_unavailable/,
      );
    }
  });

  it("names the environment variable that is missing, for the operator warning", () => {
    expect(missingCredentialEnv(OIDC)).toBe("CORP_OIDC_SECRET");
    expect(missingCredentialEnv(SAML)).toBe("ACME_SAML_CERT");
    expect(missingCredentialEnv(PUBLIC_OIDC)).toBeUndefined();
  });
});
