import { describe, expect, it } from "vitest";
import { bootTargetFrom, projectParamIn } from "./boot-target";

describe("bootTargetFrom", () => {
  it("starts on Home when the URL names no project", () => {
    expect(bootTargetFrom("", "")).toEqual({ project: null, view: "home" });
  });

  it("starts on the workspace when the URL names a project", () => {
    expect(bootTargetFrom("?project=/home/user/projects/todo", "")).toEqual({
      project: "/home/user/projects/todo",
      view: "workspace",
    });
  });

  it("decodes the project path", () => {
    expect(projectParamIn("?project=%2Fhome%2Fuser%2Fmy%20app")).toBe("/home/user/my app");
  });

  it("keeps a shared link on the workspace even without ?project=", () => {
    expect(bootTargetFrom("", "#share=abc")).toEqual({ project: null, view: "workspace" });
  });

  it("does not treat an empty project parameter as a project", () => {
    expect(projectParamIn("?project=")).toBeNull();
    expect(bootTargetFrom("?project=", "").view).toBe("home");
  });
});
