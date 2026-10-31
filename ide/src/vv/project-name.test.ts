import { describe, expect, it } from "vitest";
import { confirmsProjectName, projectName } from "./project-name";

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

describe("confirmsProjectName", () => {
  it("accepts the exact name, with surrounding whitespace trimmed", () => {
    expect(confirmsProjectName("/home/user/projects/alpha", "alpha")).toBe(true);
    expect(confirmsProjectName("/home/user/projects/alpha", "  alpha\n")).toBe(true);
  });

  it("rejects a near miss", () => {
    expect(confirmsProjectName("/home/user/projects/alpha", "Alpha")).toBe(false);
    expect(confirmsProjectName("/home/user/projects/alpha", "alpha-2")).toBe(false);
    expect(confirmsProjectName("/home/user/projects/alpha", "")).toBe(false);
  });
});
