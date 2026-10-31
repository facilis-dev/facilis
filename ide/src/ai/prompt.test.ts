import { describe, expect, it } from "vitest";
import { buildSystemPrompt, SYSTEM_PROMPT, type PromptContext } from "./prompt";

function context(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    manifest: {
      revision: "abc123",
      config: { name: "demo" },
      routes: [{ method: "GET", path: "/api/ping" }],
    },
    manifestRevision: "abc123",
    files: ["src/App.tsx", "server/routes/api/ping.get.ts", "facilis.config.ts"],
    activeFile: { path: "src/App.tsx", content: "export const App = () => null;" },
    configFile: { path: "facilis.config.ts", content: "export const config = {};" },
    ...overrides,
  };
}

describe("SYSTEM_PROMPT", () => {
  it("states every SPEC §9.2 rule", () => {
    for (const rule of [
      "defineAuthorizedHandler",
      "dbTables",
      "permission",
      "Zod",
      "pgPolicy",
      "ENABLE ROW LEVEL SECURITY",
      "existing blocks",
      't("key")',
      "locales/en.json",
      "minimal patches",
      "Do not invent roles or permissions",
      "config.auth.permissions",
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });

  it("states the browser/server boundary rules", () => {
    for (const token of [
      "browser code",
      "process",
      "import.meta.env",
      "server-only",
      "runs in Nitro",
      'fetch("/api/...")',
    ]) {
      expect(SYSTEM_PROMPT).toContain(token);
    }
  });

  it("states the one-object response contract", () => {
    for (const token of [
      "Return exactly one JSON object",
      '"message"',
      '"patches"',
      '"action"',
      '"notes"',
      "requires_confirmation",
      "server/",
      "delete",
      "Never put secrets",
    ]) {
      expect(SYSTEM_PROMPT).toContain(token);
    }
  });
});

describe("buildSystemPrompt", () => {
  it("appends a project context section with every piece", () => {
    const prompt = buildSystemPrompt(context());
    expect(prompt.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain("## Project context");
    expect(prompt).toContain("Manifest revision: abc123");
    expect(prompt).toContain("- facilis.config.ts");
    expect(prompt).toContain("- server/routes/api/ping.get.ts");
    expect(prompt).toContain("- src/App.tsx");
    expect(prompt).toContain("export const config = {};");
    expect(prompt).toContain("export const App = () => null;");
    expect(prompt).toContain('"revision": "abc123"');
  });

  it("sorts the file list", () => {
    const prompt = buildSystemPrompt(context());
    const at = (path: string) => prompt.indexOf("- " + path);
    expect(at("facilis.config.ts")).toBeLessThan(at("server/routes/api/ping.get.ts"));
    expect(at("server/routes/api/ping.get.ts")).toBeLessThan(at("src/App.tsx"));
  });

  it("handles a null manifest, config and active file", () => {
    const prompt = buildSystemPrompt(
      context({
        manifest: null,
        manifestRevision: null,
        files: [],
        activeFile: null,
        configFile: null,
      }),
    );
    expect(prompt).toContain("Manifest revision: unreachable");
    expect(prompt).toContain("Facilis config: (unavailable)");
    expect(prompt).toContain("Active file: (none)");
    expect(prompt).toContain("Project files (0):");
    expect(prompt).toContain("(unavailable)");
  });

  it("caps the manifest JSON at 16000 characters", () => {
    const prompt = buildSystemPrompt(
      context({ manifest: { blob: "x".repeat(20_000) }, configFile: null, activeFile: null }),
    );
    expect(prompt).toContain("[truncated]");
    expect(prompt.includes("x".repeat(16_000))).toBe(false);
    expect(prompt.includes("x".repeat(15_000))).toBe(true);
  });

  it("caps file content at 12000 characters", () => {
    const content = "z".repeat(20_000);
    const prompt = buildSystemPrompt(
      context({
        configFile: { path: "facilis.config.ts", content },
        activeFile: { path: "src/App.tsx", content },
        manifest: null,
      }),
    );
    expect(prompt).toContain("z".repeat(12_000));
    expect(prompt.includes("z".repeat(12_001))).toBe(false);
    expect(prompt).toContain("[truncated]");
  });

  it("caps the file list at 500 sorted paths", () => {
    const files = Array.from(
      { length: 600 },
      (_, index) => `src/file-${String(index).padStart(3, "0")}.ts`,
    );
    const prompt = buildSystemPrompt(context({ files, manifest: null }));
    expect(prompt).toContain("- src/file-000.ts");
    expect(prompt).toContain("- src/file-499.ts");
    expect(prompt.includes("src/file-500.ts")).toBe(false);
    expect(prompt).toContain("[truncated]");
  });
});
