import { describe, expect, it } from "vitest";
import type { PtcToolSpec } from "./ptc/protocol";
import { buildSystemPrompt, type PromptContext } from "./prompt";

const BASE: PtcToolSpec[] = [
  { name: "read_file", signature: "read_file({ path })", description: "Read a slice." },
];

function context(tools: readonly PtcToolSpec[]): PromptContext {
  return {
    manifest: null,
    manifestRevision: null,
    files: [],
    activeFile: null,
    configFile: null,
    instructions: null,
    designFile: null,
    tools,
  };
}

describe("git prompt section", () => {
  it("appears only when a git tool is registered", () => {
    const git: PtcToolSpec = {
      name: "git_status",
      signature: "git_status()",
      description: "Repository state.",
    };
    const withGit = buildSystemPrompt(context([...BASE, git]));
    expect(withGit).toContain("## The project repository (git tools)");
    expect(withGit).toContain("LOCAL commit");
    expect(withGit).toContain("never ask for or pass a token");
    expect(withGit).toContain("no shell");
    expect(buildSystemPrompt(context(BASE))).not.toContain("## The project repository (git tools)");
  });
});
