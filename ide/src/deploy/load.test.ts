import { describe, expect, it } from "vitest";
import { deploymentFromEnv, parseDeploymentText } from "./load";
import { DeploymentError } from "./validate";

const MANAGED = JSON.stringify({
  profile: "managed",
  company: { name: "Acme", domain: "facilis.acme.example" },
  packages: { registry: "https://npm.acme.example" },
  projects: { preview: { origin: "https://preview.facilis.acme.example" } },
});

function errorOf(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
}

describe("deployment loading", () => {
  it("parses a manageable document", () => {
    const d = parseDeploymentText(MANAGED, "acme.json");
    expect(d.profile).toBe("managed");
    expect(d.packages.registry).toBe("https://npm.acme.example");
  });

  it("reports invalid JSON with the file name", () => {
    expect(() => parseDeploymentText("{", "acme.json")).toThrow(/acme\.json: not valid JSON/);
  });

  it("an unset variable is the open profile", () => {
    const d = deploymentFromEnv({ value: undefined, readFile: () => MANAGED });
    expect(d.profile).toBe("open");
  });

  it("a set but empty variable is an error, not the open profile", () => {
    const message = errorOf(() => deploymentFromEnv({ value: "  ", readFile: () => MANAGED }));
    expect(message).toContain("set but empty");
  });

  it("a missing file fails with a readable error", () => {
    const message = errorOf(() =>
      deploymentFromEnv({
        value: "./missing.json",
        readFile: () => {
          throw new Error("ENOENT");
        },
      }),
    );
    expect(message).toContain("./missing.json: cannot read: ENOENT");
  });

  it("a config without a profile is rejected", () => {
    expect(() =>
      deploymentFromEnv({ value: "acme.json", readFile: () => '{"packages":{}}' }),
    ).toThrow(/profile: required when FACILIS_DEPLOY_CONFIG is set/);
  });

  it("surfaces validation issues with the file name", () => {
    expect(() =>
      deploymentFromEnv({
        value: "acme.json",
        readFile: () => '{"profile":"managed","company":{"name":"Acme"}}',
      }),
    ).toThrow(DeploymentError);
  });
});
