import { describe, expect, it } from "vitest";
import { buildChatContext, type ContextHost } from "./chat-context";

function host(
  options: {
    instructions?: string;
    design?: string;
    active?: { path: string; content: string };
  } = {},
) {
  const files = ["AGENTS.md", "DESIGN.md", "facilis.config.ts", "src/App.tsx"];
  const contextHost: ContextHost = {
    files: () => files,
    read: async (path) => {
      if (path === "AGENTS.md") return options.instructions ?? "";
      if (path === "DESIGN.md") return options.design ?? "";
      if (path === "facilis.config.ts") return "export const config = {};\n";
      return "";
    },
    activeFile: async () => options.active ?? null,
    manifestBase: () => null,
  };
  return contextHost;
}

describe("buildChatContext", () => {
  it("includes AGENTS.md in the prompt and reports it", async () => {
    const result = await buildChatContext(
      host({ instructions: "Prefer tiny patches." }),
      new AbortController().signal,
    );
    expect(result.system).toContain("## Project instructions (AGENTS.md)");
    expect(result.system).toContain("Prefer tiny patches.");
    expect(result.context.instructions).toBe(true);
    expect(result.context.files).toBe(4);
    expect(result.context.manifestRevision).toBeNull();
  });

  it("prefers the unsaved editor buffer of AGENTS.md", async () => {
    const result = await buildChatContext(
      host({
        instructions: "text from disk",
        active: { path: "AGENTS.md", content: "text from the buffer" },
      }),
      new AbortController().signal,
    );
    expect(result.system).toContain("text from the buffer");
    expect(result.system).not.toContain("text from disk");
  });

  it("omits the section when the project has no AGENTS.md", async () => {
    const result = await buildChatContext(host(), new AbortController().signal);
    expect(result.system).not.toContain("## Project instructions");
    expect(result.context.instructions).toBe(false);
  });

  it("injects the project DESIGN.md as project data (D-185)", async () => {
    const result = await buildChatContext(
      host({ design: "The canvas is bone." }),
      new AbortController().signal,
    );
    expect(result.system).toContain("## Project design (DESIGN.md)");
    expect(result.system).toContain("The canvas is bone.");
    expect(result.context.files).toBe(4);
  });

  it("prefers the unsaved editor buffer of DESIGN.md", async () => {
    const result = await buildChatContext(
      host({
        design: "text from disk",
        active: { path: "DESIGN.md", content: "text from the buffer" },
      }),
      new AbortController().signal,
    );
    expect(result.system).toContain("text from the buffer");
    expect(result.system).not.toContain("text from disk");
  });

  it("omits the design section when the project has no DESIGN.md", async () => {
    const result = await buildChatContext(host(), new AbortController().signal);
    expect(result.system).not.toContain("## Project design");
  });
});
