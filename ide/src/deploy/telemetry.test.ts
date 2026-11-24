import { describe, expect, it } from "vitest";
import { openDeployment, resolveDeployment } from "./resolve";
import { resolveTelemetry } from "./telemetry";
import type { DeploymentInput, DeploymentTelemetry } from "./types";
import { DeploymentError, validateDeployment } from "./validate";

function managed(overrides: DeploymentInput = {}): DeploymentInput {
  return {
    profile: "managed",
    company: { name: "Acme", domain: "facilis.acme.example" },
    packages: { registry: "https://npm.acme.example" },
    projects: { preview: { origin: "https://preview.facilis.acme.example" } },
    ...overrides,
  };
}

function withTelemetry(telemetry: DeploymentTelemetry): DeploymentInput {
  return managed({ telemetry });
}

function issuesOf(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (error) {
    if (!(error instanceof DeploymentError)) throw error;
    return error.issues.join("\n");
  }
}

const ENDPOINT = "https://otlp.acme.example/v1/traces";
const TENANT_KEY = "pub_write_only_abc123";

describe("telemetry defaults", () => {
  it("is off, with no target and no sampling", () => {
    expect(resolveTelemetry()).toEqual({
      enabled: false,
      be: { enabled: false },
      fe: { enabled: false },
      exporterEndpoint: null,
      tenantKey: null,
      sampling: 1,
      originAllowlist: [],
      dashboardUrl: null,
    });
  });

  it("stays off in both profiles when the config is silent", () => {
    expect(openDeployment().telemetry.enabled).toBe(false);
    expect(resolveDeployment(managed()).telemetry.enabled).toBe(false);
  });
});

describe("telemetry validation", () => {
  it("accepts the full block", () => {
    const config = withTelemetry({
      enabled: true,
      be: { enabled: true },
      fe: { enabled: true },
      exporterEndpoint: ENDPOINT,
      tenantKey: TENANT_KEY,
      sampling: 0.25,
      originAllowlist: ["https://app.acme.example"],
      dashboardUrl: "https://grafana.acme.example",
    });
    expect(validateDeployment(config)).toBe(config);
  });

  it("rejects an unknown key instead of ignoring a typo", () => {
    expect(
      issuesOf(() => validateDeployment({ telemetry: { enabled: false, exporter: ENDPOINT } })),
    ).toContain("deployment.telemetry.exporter: unknown key");
  });

  it("rejects an unknown key inside a half", () => {
    expect(issuesOf(() => validateDeployment({ telemetry: { be: { sample: true } } }))).toContain(
      "deployment.telemetry.be.sample: unknown key",
    );
  });

  it("rejects a sampling ratio outside 0..1", () => {
    expect(
      issuesOf(() => validateDeployment({ telemetry: { enabled: false, sampling: 2 } })),
    ).toContain("deployment.telemetry.sampling: expected a number between 0 and 1");
  });

  it("rejects an endpoint that is not an absolute http(s) URL", () => {
    expect(
      issuesOf(() => validateDeployment({ telemetry: { exporterEndpoint: "otlp.acme.example" } })),
    ).toContain("deployment.telemetry.exporterEndpoint: expected an absolute http(s) URL");
  });

  it("rejects an allowlist entry that is not an exact origin", () => {
    const issues = issuesOf(() =>
      validateDeployment({ telemetry: { originAllowlist: ["https://app.acme.example/path"] } }),
    );
    expect(issues).toContain(
      "deployment.telemetry.originAllowlist: expected an exact origin (scheme://host[:port])",
    );
  });

  it("rejects a tenant key with whitespace", () => {
    expect(issuesOf(() => validateDeployment({ telemetry: { tenantKey: "pub key" } }))).toContain(
      "deployment.telemetry.tenantKey: expected a non-empty string without whitespace",
    );
  });
});

describe("telemetry resolution", () => {
  it("enables both halves from the master switch alone", () => {
    const d = resolveDeployment(
      withTelemetry({ enabled: true, exporterEndpoint: ENDPOINT, tenantKey: TENANT_KEY }),
    );
    expect(d.telemetry).toEqual({
      enabled: true,
      be: { enabled: true },
      fe: { enabled: true },
      exporterEndpoint: ENDPOINT,
      tenantKey: TENANT_KEY,
      sampling: 1,
      originAllowlist: [],
      dashboardUrl: null,
    });
  });

  it("allows a backend-only deployment with no public key", () => {
    const d = resolveDeployment(
      withTelemetry({
        enabled: true,
        be: { enabled: true },
        fe: { enabled: false },
        exporterEndpoint: ENDPOINT,
      }),
    );
    expect(d.telemetry.be.enabled).toBe(true);
    expect(d.telemetry.fe.enabled).toBe(false);
    expect(d.telemetry.tenantKey).toBeNull();
  });

  it("allows a frontend-only deployment with no collector", () => {
    const d = resolveDeployment(
      withTelemetry({
        enabled: true,
        be: { enabled: false },
        fe: { enabled: true },
        tenantKey: TENANT_KEY,
      }),
    );
    expect(d.telemetry.exporterEndpoint).toBeNull();
    expect(d.telemetry.fe.enabled).toBe(true);
  });

  it("reduces the allowlist to deduped origins and trims the URLs", () => {
    const d = resolveDeployment(
      withTelemetry({
        enabled: true,
        exporterEndpoint: ENDPOINT + "/",
        tenantKey: TENANT_KEY,
        originAllowlist: ["https://app.acme.example/", "https://app.acme.example"],
        dashboardUrl: "https://grafana.acme.example/",
      }),
    );
    expect(d.telemetry.exporterEndpoint).toBe(ENDPOINT);
    expect(d.telemetry.dashboardUrl).toBe("https://grafana.acme.example");
    expect(d.telemetry.originAllowlist).toEqual(["https://app.acme.example"]);
  });

  it("rejects an enabled build whose half has no target", () => {
    expect(issuesOf(() => resolveDeployment(withTelemetry({ enabled: true })))).toContain(
      "telemetry.exporterEndpoint: required when telemetry.be is enabled",
    );
    expect(issuesOf(() => resolveDeployment(withTelemetry({ enabled: true })))).toContain(
      "telemetry.tenantKey: required when telemetry.fe is enabled",
    );
  });

  it("rejects an enabled build that switched both halves off", () => {
    expect(
      issuesOf(() =>
        resolveDeployment(
          withTelemetry({ enabled: true, be: { enabled: false }, fe: { enabled: false } }),
        ),
      ),
    ).toContain("telemetry.enabled: requires telemetry.be.enabled or telemetry.fe.enabled");
  });

  it("rejects a target left behind a switch that is off", () => {
    expect(issuesOf(() => resolveDeployment(withTelemetry({ tenantKey: TENANT_KEY })))).toContain(
      "telemetry.tenantKey: requires telemetry.enabled",
    );
    expect(
      issuesOf(() => resolveDeployment(withTelemetry({ exporterEndpoint: ENDPOINT }))),
    ).toContain("telemetry.exporterEndpoint: requires telemetry.enabled");
  });

  it("rejects a sampling ratio left behind a switch that is off", () => {
    expect(issuesOf(() => resolveDeployment(withTelemetry({ sampling: 0.5 })))).toContain(
      "telemetry.sampling: requires telemetry.enabled",
    );
  });

  it("rejects an ingestion allowlist when the frontend half is off", () => {
    expect(
      issuesOf(() =>
        resolveDeployment(
          withTelemetry({
            enabled: true,
            be: { enabled: true },
            fe: { enabled: false },
            exporterEndpoint: ENDPOINT,
            originAllowlist: ["https://app.acme.example"],
          }),
        ),
      ),
    ).toContain("telemetry.originAllowlist: requires telemetry.fe.enabled");
  });

  it("rejects enabling a half without the master switch", () => {
    expect(issuesOf(() => resolveDeployment(withTelemetry({ be: { enabled: true } })))).toContain(
      "telemetry.be.enabled: requires telemetry.enabled",
    );
  });
});
