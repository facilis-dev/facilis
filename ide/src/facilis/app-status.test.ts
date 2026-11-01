import { describe, expect, it } from "vitest";
import { checkProject, readAppManifest } from "./app-status";
import { renderAppManifest } from "./app-manifest";

const ROOT = "/home/user/projects/app";

describe("project status", () => {
  it("reads the marker through the injected reader", async () => {
    const read = async (path: string) => {
      expect(path).toBe(ROOT + "/facilis.app.json");
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
});
