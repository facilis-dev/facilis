import { describe, expect, it } from "vitest";
import { isProjectIndexReady } from "./project-graph-readiness";

const ROOT = "/home/user/projects/facilis-app";
const abs = (relative: string): string => ROOT + "/" + relative;

describe("isProjectIndexReady", () => {
  it("is not ready without an active project", () => {
    expect(isProjectIndexReady([abs("package.json")], null)).toBe(false);
  });

  it("is not ready while the index is still empty (the cold-boot race)", () => {
    // openFolder() starts indexFolder() asynchronously; the panel mounts before it lands.
    expect(isProjectIndexReady([], ROOT)).toBe(false);
  });

  it("is not ready while only another project is indexed", () => {
    expect(isProjectIndexReady(["/home/user/projects/other/package.json"], ROOT)).toBe(false);
  });

  it("opens on one indexed file, at the root or nested", () => {
    expect(isProjectIndexReady([abs("package.json")], ROOT)).toBe(true);
    expect(isProjectIndexReady([abs("src/pages/index.tsx")], ROOT)).toBe(true);
  });

  it("does not mistake a sibling path prefix for the project", () => {
    expect(isProjectIndexReady([ROOT + "-sibling/package.json"], ROOT)).toBe(false);
  });

  it("accepts a trailing slash on the root, like the controller does", () => {
    expect(isProjectIndexReady([abs("package.json")], ROOT + "/")).toBe(true);
  });
});
