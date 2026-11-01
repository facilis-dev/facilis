import { describe, expect, it } from "vitest";
import { openDeployment, resolveDeployment } from "./resolve";
import type { DeploymentInput } from "./types";

function managed(overrides: DeploymentInput = {}): DeploymentInput {
  return {
    profile: "managed",
    company: { name: "Acme", domain: "facilis.acme.example" },
    packages: { registry: "https://npm.acme.example" },
    projects: { preview: { origin: "https://preview.facilis.acme.example" } },
    ...overrides,
  };
}

function errorOf(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "not an Error";
  }
}

describe("deployment resolution", () => {
  it("the open profile keeps today's defaults", () => {
    const d = openDeployment();
    expect(d.profile).toBe("open");
    expect(d.packages.registry).toBeNull();
    expect(d.projects.imports).toEqual({ folder: true, git: true, share: true });
    expect(d.projects.admission).toBe("any");
    expect(d.ai.mode).toBe("byo");
    expect(d.updates.channel).toBe("latest");
  });

  it("managed defaults are restrictive", () => {
    const d = resolveDeployment(managed());
    expect(d.projects.admission).toBe("facilis-only");
    expect(d.projects.imports).toEqual({ folder: false, git: false, share: false });
    expect(d.ai.mode).toBe("off");
    expect(d.packages.lockfile).toBe("required");
    expect(d.updates.channel).toBe("approved");
  });

  it("strips a trailing slash from registry and preview origin", () => {
    const d = resolveDeployment(
      managed({
        packages: { registry: "https://npm.acme.example/" },
        projects: { preview: { origin: "https://preview.facilis.acme.example/" } },
      }),
    );
    expect(d.packages.registry).toBe("https://npm.acme.example");
    expect(d.projects.preview.origin).toBe("https://preview.facilis.acme.example");
  });

  it("requires a registry in a managed build", () => {
    expect(errorOf(() => resolveDeployment(managed({ packages: {} })))).toContain(
      "packages.registry: required in a managed build",
    );
  });

  it("requires an isolated preview origin in a managed build", () => {
    expect(errorOf(() => resolveDeployment(managed({ projects: {} })))).toContain(
      "projects.preview.origin: required in a managed build",
    );
  });

  it("refuses a preview origin on the deployment origin", () => {
    const message = errorOf(() =>
      resolveDeployment(
        managed({ projects: { preview: { origin: "https://facilis.acme.example" } } }),
      ),
    );
    expect(message).toContain("projects.preview.origin: must differ from the deployment origin");
  });

  it("requires providers when AI is byo", () => {
    const message = errorOf(() => resolveDeployment(managed({ ai: { mode: "byo" } })));
    expect(message).toContain("ai.providers: required when ai.mode is 'byo'");
  });

  it("accepts an allowlisted provider", () => {
    const d = resolveDeployment(managed({ ai: { mode: "byo", providers: ["anthropic"] } }));
    expect(d.ai.providers).toEqual(["anthropic"]);
  });

  it("refuses the custom provider (it has no fixed host)", () => {
    const message = errorOf(() =>
      resolveDeployment(managed({ ai: { mode: "byo", providers: ["custom"] } })),
    );
    expect(message).toContain("ai.providers: 'custom' has no fixed host");
  });

  it("requires a gateway URL when the mode is gateway", () => {
    const message = errorOf(() => resolveDeployment(managed({ ai: { mode: "gateway" } })));
    expect(message).toContain("ai.gateway: required when ai.mode is 'gateway'");
  });

  it("refuses import paths in a managed build", () => {
    const message = errorOf(() =>
      resolveDeployment(
        managed({
          projects: {
            preview: { origin: "https://preview.facilis.acme.example" },
            imports: { git: true },
          },
        }),
      ),
    );
    expect(message).toContain("projects.imports.git: must stay false in a managed build");
  });

  it("refuses providers when AI is off", () => {
    const message = errorOf(() =>
      resolveDeployment(managed({ ai: { mode: "off", providers: ["anthropic"] } })),
    );
    expect(message).toContain("ai.providers: meaningless when ai.mode is 'off'");
  });

  it("freezes the resolved profile", () => {
    const d = resolveDeployment(managed());
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.packages.allow)).toBe(true);
  });
});
