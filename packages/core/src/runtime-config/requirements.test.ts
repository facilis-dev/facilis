import { describe, expect, it } from "vitest";

import { KNOWN_RUNTIME_KEYS, RUNTIME_CANONICAL, runtimeRequirements } from "./index.ts";

const KNOWN = new Set<string>(KNOWN_RUNTIME_KEYS);

describe("runtimeRequirements (D-224)", () => {
  it("only names keys the framework knows", () => {
    for (const requirement of runtimeRequirements) {
      expect(KNOWN.has(requirement.key), requirement.key).toBe(true);
      if (requirement.when !== undefined) expect(KNOWN.has(requirement.when.key)).toBe(true);
    }
  });

  it("has a canonical value to print in the missing-key line", () => {
    const canonical: Readonly<Record<string, unknown>> = RUNTIME_CANONICAL;
    for (const requirement of runtimeRequirements) {
      expect(canonical, requirement.key).toHaveProperty(requirement.key);
    }
  });

  it("marks a secret requirement exactly when its canonical value is a secret marker", () => {
    const canonical: Readonly<Record<string, unknown>> = RUNTIME_CANONICAL;
    for (const requirement of runtimeRequirements) {
      const value = canonical[requirement.key];
      const marker = typeof value === "object" && value !== null && "secret" in value;
      expect(requirement.secret === true, requirement.key).toBe(marker);
    }
  });

  it("requires the always-on deployment core", () => {
    const always = runtimeRequirements.filter((entry) => entry.when === undefined);
    expect(always.map((entry) => entry.key)).toEqual(["databaseMode", "logLevel"]);
  });
});
