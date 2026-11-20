import { describe, expect, it } from "vitest";
import { frameworkPackageMinimums } from "@/deploy/current";
import { checkProject, readAppManifest } from "./app-status";
import { renderAppManifest } from "./app-manifest";
import { FRAMEWORK_MINIMUM_TARGET } from "./update-recipes";

const ROOT = "/home/user/projects/app";

describe("project status", () => {
  it("reads the marker through the injected reader", async () => {
    const read = async (path: string) => {
      expect(path).toBe(ROOT + "/.facilis/facilis.app.json");
      return renderAppManifest("2026.10");
    };
    const manifest = await readAppManifest(read, ROOT + "/");
    expect(manifest?.environmentVersion).toBe("2026.10");
  });

  it("treats an unreadable or absent marker as unknown", async () => {
    expect(
      await readAppManifest(async () => {
        throw new Error("ENOENT");
      }, ROOT),
    ).toBeNull();
    expect(await readAppManifest(async () => "not json", ROOT)).toBeNull();
  });

  it("plans against the build version", async () => {
    const read = async () => renderAppManifest("2026.10");
    const plan = await checkProject(read, ROOT, "2026.11", []);
    expect(plan.status).toBe("outdated");
    expect(plan.projectVersion).toBe("2026.10");
    expect(plan.currentVersion).toBe("2026.11");
    expect(plan.steps).toEqual([]);
  });

  it("reports an ahead project without planning a downgrade", async () => {
    const read = async () => renderAppManifest("2026.12");
    const plan = await checkProject(read, ROOT, "2026.11", []);
    expect(plan.status).toBe("ahead");
    expect(plan.steps).toEqual([]);
  });

  // D-198: below-minimum pins are a required update even when the marker is current.
  it("registers below-minimum framework pins as a required update", async () => {
    const pkg = JSON.stringify({ dependencies: { "@facilis.dev/core": "0.0.0" } });
    const read = async (path: string) =>
      path.endsWith("/package.json") ? pkg : renderAppManifest("2026.11");
    const plan = await checkProject(read, ROOT, "2026.11");
    expect(plan.status).toBe("outdated");
    expect(plan.steps.map((step) => step.to)).toEqual([FRAMEWORK_MINIMUM_TARGET]);
    expect(plan.changes.map((change) => change.path)).toEqual(["package.json"]);
  });

  it("leaves a current project whose pins satisfy the minimums alone", async () => {
    const pkg = JSON.stringify({
      dependencies: { "@facilis.dev/core": frameworkPackageMinimums["@facilis.dev/core"] },
    });
    const read = async (path: string) =>
      path.endsWith("/package.json") ? pkg : renderAppManifest("2026.11");
    const plan = await checkProject(read, ROOT, "2026.11");
    expect(plan.status).toBe("current");
    expect(plan.steps).toEqual([]);
    expect(plan.changes).toEqual([]);
  });
});
