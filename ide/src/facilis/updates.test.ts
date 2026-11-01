import { describe, expect, it } from "vitest";
import { compareVersions, parseVersion, planUpdate, updateStatus } from "./updates";

describe("version comparison", () => {
  it("parses calver-ish versions", () => {
    expect(parseVersion("2026.11")).toEqual([2026, 11]);
    expect(parseVersion("0.0.0")).toEqual([0, 0, 0]);
    expect(parseVersion("2026.11.1-beta")).toEqual([2026, 11, 1]);
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("dev")).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it("compares numerically and treats missing components as zero", () => {
    expect(compareVersions("2026.11", "2026.10")).toBeGreaterThan(0);
    expect(compareVersions("2026.10", "2026.11")).toBeLessThan(0);
    expect(compareVersions("2026.11", "2026.11.0")).toBe(0);
    expect(compareVersions("2026.2", "2026.10")).toBeLessThan(0);
    expect(compareVersions("nope", "2026.11")).toBeNull();
  });
});

describe("project update status", () => {
  it("is unknown without a marker or a parseable version", () => {
    expect(updateStatus(null, "2026.11")).toBe("unknown");
    expect(updateStatus("canary", "2026.11")).toBe("unknown");
  });

  it("is current, outdated or ahead", () => {
    expect(updateStatus("2026.11", "2026.11")).toBe("current");
    expect(updateStatus("2026.10", "2026.11")).toBe("outdated");
    expect(updateStatus("2026.12", "2026.11")).toBe("ahead");
  });

  it("never reports an unknown project as up to date", () => {
    expect(updateStatus(undefined, "2026.11")).toBe("unknown");
  });
});

describe("update planning", () => {
  const recipes = [
    { from: "2026.09", to: "2026.10" },
    { from: "2026.10", to: "2026.11" },
    { from: "2026.11", to: "2026.12" },
  ];

  it("selects only the recipes between the project and this build", () => {
    const plan = planUpdate({ projectVersion: "2026.09", currentVersion: "2026.11", recipes });
    expect(plan.status).toBe("outdated");
    expect(plan.steps.map((step) => step.to)).toEqual(["2026.10", "2026.11"]);
  });

  it("plans nothing when the project is current", () => {
    const plan = planUpdate({ projectVersion: "2026.11", currentVersion: "2026.11", recipes });
    expect(plan.status).toBe("current");
    expect(plan.steps).toEqual([]);
  });

  it("plans nothing when the project is ahead or unknown", () => {
    for (const plan of [
      planUpdate({ projectVersion: "2026.12", currentVersion: "2026.11", recipes }),
      planUpdate({ projectVersion: null, currentVersion: "2026.11", recipes }),
    ]) {
      expect(plan.steps).toEqual([]);
    }
  });

  it("ships no recipe today, so an outdated project plans nothing", () => {
    const plan = planUpdate({ projectVersion: "2026.10", currentVersion: "2026.11" });
    expect(plan.status).toBe("outdated");
    expect(plan.steps).toEqual([]);
  });
});
