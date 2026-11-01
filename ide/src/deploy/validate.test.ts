import { describe, expect, it } from "vitest";
import { DeploymentError, validateDeployment } from "./validate";

function issuesOf(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (error) {
    if (!(error instanceof DeploymentError)) return "not a DeploymentError";
    return error.issues.join("\n");
  }
}

describe("deployment config validation", () => {
  it("accepts an empty config (the open profile)", () => {
    expect(validateDeployment({})).toEqual({});
  });

  it("accepts a full managed config", () => {
    const config = {
      schemaVersion: 1,
      profile: "managed",
      company: { name: "Acme", domain: "facilis.acme.example" },
      packages: {
        registry: "https://npm.acme.example",
        allow: ["react"],
        installScripts: "deny",
        lockfile: "required",
      },
      projects: {
        admission: "facilis-only",
        imports: { folder: false, git: false, npm: false, share: false },
        preview: { origin: "https://preview.facilis.acme.example" },
        shell: "run-only",
      },
      ai: { mode: "off", providers: [] },
      skills: { allow: [] },
      network: { connect: [] },
      updates: { channel: "approved", baseline: "2026.11" },
    };
    expect(validateDeployment(config)).toBe(config);
  });

  it("rejects unknown keys instead of ignoring a typo", () => {
    const issues = issuesOf(() => validateDeployment({ profile: "open", extra: true }));
    expect(issues).toContain("deployment.extra: unknown key");
  });

  it("rejects an unknown nested key", () => {
    const issues = issuesOf(() =>
      validateDeployment({ packages: { allow: [], allowed: ["react"] } }),
    );
    expect(issues).toContain("deployment.packages.allowed: unknown key");
  });

  it("rejects a non-object document", () => {
    expect(issuesOf(() => validateDeployment([]))).toContain("expected a JSON object");
  });

  it("rejects an unknown profile", () => {
    const issues = issuesOf(() => validateDeployment({ profile: "enterprise" }));
    expect(issues).toContain("deployment.profile: expected one of open, managed");
  });

  it("rejects a non-URL registry", () => {
    const issues = issuesOf(() =>
      validateDeployment({ packages: { registry: "npm.acme.example" } }),
    );
    expect(issues).toContain("deployment.packages.registry: expected an absolute http(s) URL");
  });

  it("rejects a non-boolean import flag", () => {
    const issues = issuesOf(() => validateDeployment({ projects: { imports: { git: "yes" } } }));
    expect(issues).toContain("deployment.projects.imports.git: expected a boolean");
  });

  it("rejects a gateway that is not a URL", () => {
    const issues = issuesOf(() => validateDeployment({ ai: { gateway: "llm" } }));
    expect(issues).toContain("deployment.ai.gateway: expected an absolute http(s) URL");
  });

  it("rejects an unsupported schemaVersion", () => {
    const issues = issuesOf(() => validateDeployment({ schemaVersion: 2 }));
    expect(issues).toContain("deployment.schemaVersion: only 1 is supported");
  });

  it("rejects an empty string in an allowlist", () => {
    const issues = issuesOf(() => validateDeployment({ packages: { allow: [""] } }));
    expect(issues).toContain("deployment.packages.allow: expected an array of non-empty strings");
  });
});
