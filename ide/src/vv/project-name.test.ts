import { describe, expect, it } from "vitest";
import { projectName } from "./project-name";

// The label IS the folder on disk: a name derived from anywhere else (a create form,
// a kernel title, a stored registry entry) could disagree with the path the tab, the
// Web Lock and ?project= all identify.
describe("projectName", () => {
  it("is the last segment of the project root", () => {
    expect(projectName("/home/user/projects/alpha")).toBe("alpha");
    expect(projectName("/home/user/projects/facilis-ts-appx")).toBe("facilis-ts-appx");
  });

  it("ignores trailing slashes", () => {
    expect(projectName("/home/user/projects/alpha/")).toBe("alpha");
  });

  it("falls back to the filesystem root rather than an empty label", () => {
    expect(projectName("/")).toBe("/");
  });
});
