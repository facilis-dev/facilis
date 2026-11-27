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
    // storageDriver is always-on: the boot resolves the storage target even for a project that
    // never uploads, and an absent key degrades the subsystem (D-224).
    expect(always.map((entry) => entry.key)).toEqual(["databaseMode", "logLevel", "storageDriver"]);
  });

  it("requires the S3 credentials only with the s3 driver", () => {
    const s3 = runtimeRequirements.filter((entry) => entry.when?.equals === "s3");
    expect(s3.map((entry) => entry.key)).toEqual([
      "s3Bucket",
      "s3Region",
      "s3AccessKeyId",
      "s3SecretAccessKey",
    ]);
    expect(s3.filter((entry) => entry.secret === true).map((entry) => entry.key)).toEqual([
      "s3AccessKeyId",
      "s3SecretAccessKey",
    ]);
  });
});
