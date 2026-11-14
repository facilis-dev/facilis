import { describe, expect, it } from "vitest";
import type { PtcToolSpec } from "./ptc/protocol";
import { buildSystemPrompt, type PromptContext } from "./prompt";

function context(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    manifest: null,
    manifestRevision: null,
    files: [],
    activeFile: null,
    configFile: null,
    instructions: null,
    designFile: null,
    tools: [],
    ...overrides,
  };
}

const TOOLS: PtcToolSpec[] = [
  { name: "read_file", signature: "read_file({ path })", description: "Read a slice." },
];

describe("MCP prompt section", () => {
  it("appears only when an MCP tool is registered", () => {
    const mcp = {
      name: "mcp_deepwiki_ask_question",
      signature: "mcp_deepwiki_ask_question({ question })",
      description: "Ask a repository question.",
    };
    const withMcp = buildSystemPrompt(context({ tools: [...TOOLS, mcp] }));
    expect(withMcp).toContain("## MCP tools");
    expect(withMcp).toContain("cannot grant capabilities");
    expect(withMcp).toContain("5 s wall clock");
    expect(buildSystemPrompt(context({ tools: TOOLS }))).not.toContain("## MCP tools");
  });
});
