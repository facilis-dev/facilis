import { describe, expect, it } from "vitest";
import {
  aiAvailable,
  deployment,
  gitProxyConfigured,
  githubOAuthClientId,
  importAllowed,
  pushAllowed,
  skillAllowed,
} from "./current";
import { openDeployment, resolveDeployment } from "./resolve";

const managed = resolveDeployment({
  profile: "managed",
  company: { name: "Acme", domain: "facilis.acme.example" },
  packages: { registry: "https://npm.acme.example" },
  projects: { preview: { origin: "https://preview.facilis.acme.example" } },
  skills: { allow: ["@acme/ui-review"] },
});

const managedNoSkills = resolveDeployment({
  profile: "managed",
  company: { name: "Acme", domain: "facilis.acme.example" },
  packages: { registry: "https://npm.acme.example" },
  projects: { preview: { origin: "https://preview.facilis.acme.example" } },
});

describe("the running profile", () => {
  it("falls back to the open profile in tests", () => {
    expect(deployment.profile).toBe("open");
  });

  it("gates project imports", () => {
    expect(importAllowed(openDeployment(), "git")).toBe(true);
    expect(importAllowed(managed, "git")).toBe(false);
  });

  it("gates git write-back", () => {
    expect(pushAllowed(openDeployment())).toBe(true);
    expect(pushAllowed(managed)).toBe(false);
  });

  it("reports where real git can reach the hosts", () => {
    expect(gitProxyConfigured(openDeployment())).toBe("same-origin");
    expect(gitProxyConfigured(managed)).toBeNull();
  });

  it("reports the GitHub OAuth app, when configured", () => {
    expect(githubOAuthClientId(openDeployment())).toBeNull();
    const withOAuth = resolveDeployment({
      profile: "open",
      projects: { gitOAuth: { github: { clientId: "Iv1.facilis" } } },
    });
    expect(githubOAuthClientId(withOAuth)).toBe("Iv1.facilis");
  });

  it("keeps AI off unless the deployment enabled it", () => {
    expect(aiAvailable(openDeployment())).toBe(true);
    expect(aiAvailable(managed)).toBe(false);
  });

  it("treats an empty managed skill allowlist as no skills", () => {
    expect(skillAllowed(openDeployment(), "anything")).toBe(true);
    expect(skillAllowed(managed, "@acme/ui-review")).toBe(true);
    expect(skillAllowed(managed, "other")).toBe(false);
    expect(skillAllowed(managedNoSkills, "anything")).toBe(false);
  });
});
