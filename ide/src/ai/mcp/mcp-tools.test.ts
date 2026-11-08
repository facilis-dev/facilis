import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "./mcp-client";
import { argsSignature, mcpErrorText, resultJson, specFor, toolNameFor } from "./mcp-tools";

const server: McpServerConfig = {
  id: "deepwiki",
  name: "DeepWiki",
  url: "https://mcp.test",
  enabled: true,
};

describe("MCP tool namespacing", () => {
  it("names tools mcp_<server>_<tool>", () => {
    expect(toolNameFor("deepwiki", "read_wiki_structure")).toBe("mcp_deepwiki_read_wiki_structure");
  });

  it("sanitises dots and slashes and caps the length", () => {
    expect(toolNameFor("my.server", "repo.get")).toBe("mcp_my_server_repo_get");
    const long = toolNameFor("s".repeat(80), "t".repeat(80));
    expect(long).toHaveLength(64);
  });

  it("renders required and optional arguments from the schema", () => {
    expect(argsSignature({ properties: { query: {}, repo: {} }, required: ["query"] })).toBe(
      "({ query, repo? })",
    );
    expect(argsSignature(null)).toBe("()");
    expect(argsSignature({ properties: {} })).toBe("()");
  });

  it("builds a spec that names the server", () => {
    const spec = specFor(server, {
      name: "ask",
      description: "Ask a question.",
      inputSchema: { properties: { question: {} }, required: ["question"] },
    });
    expect(spec.name).toBe("mcp_deepwiki_ask");
    expect(spec.signature).toBe("mcp_deepwiki_ask({ question })");
    expect(spec.description).toBe("[DeepWiki] Ask a question.");
  });

  it("caps a long description", () => {
    const spec = specFor(server, { name: "x", description: "d".repeat(400), inputSchema: null });
    expect(spec.description.length).toBeLessThan(200);
    expect(spec.description.endsWith("…")).toBe(true);
  });
});

describe("MCP tool results", () => {
  it("joins text parts and counts the rest", () => {
    expect(
      resultJson({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
          { type: "image", data: "x" },
        ],
        isError: false,
      }),
    ).toEqual({ text: "a\nb", otherParts: 1 });
  });

  it("caps a large result at 32000 characters", () => {
    const capped = resultJson({
      content: [{ type: "text", text: "x".repeat(40_000) }],
      isError: false,
    }) as { text: string; truncated?: boolean };
    expect(capped.text).toHaveLength(32_000);
    expect(capped.truncated).toBe(true);
  });

  it("extracts the text of a tool error", () => {
    expect(mcpErrorText({ content: [{ type: "text", text: "boom" }], isError: true })).toBe("boom");
    expect(mcpErrorText({ content: [], isError: true })).toContain("reported an error");
  });
});
