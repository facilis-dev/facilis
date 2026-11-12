import { describe, expect, it } from "vitest";
import type { PtcToolSpec } from "./ptc/protocol";
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
    instructions: null,
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
      "Every route carries a description",
      "never t()",
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
    expect(SYSTEM_PROMPT).toContain('description: "List todos visible to the current user."');
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
      "path is relative to the project root",
      "delete",
      "Never put secrets",
    ]) {
      expect(SYSTEM_PROMPT).toContain(token);
    }
  });

  it("states the validation repair protocol", () => {
    for (const token of [
      "## Validation repair",
      "validation repair report",
      "your previous answer was rejected",
      "fix every finding",
      "return the corrected AIResponse JSON object",
      "merged into the rejected set",
      "re-emit only the files",
      "fix_hint",
      "line/excerpt",
      "read the implicated files with the tools",
      "keep every existing declaration",
      "tables, columns, routes, config, keys",
      "never drop code you were not asked to remove",
      "destructive",
      "requires_confirmation",
      "notes",
    ]) {
      expect(SYSTEM_PROMPT).toContain(token);
    }
  });

  it("places the validation repair section after the response contract", () => {
    const contractAt = SYSTEM_PROMPT.indexOf("## Response contract");
    const repairAt = SYSTEM_PROMPT.indexOf("## Validation repair");
    expect(contractAt).toBeGreaterThan(-1);
    expect(repairAt).toBeGreaterThan(contractAt);
    expect(repairAt).toBeGreaterThan(SYSTEM_PROMPT.indexOf("Never put secrets"));
  });
});

const TOOLS: PtcToolSpec[] = [
  {
    name: "read_file",
    signature: "read_file({ path, startLine?, endLine? })",
    description: "Read a slice.",
  },
  {
    name: "validate",
    signature: "validate({ patches, requiresConfirmation? })",
    description: "Run the patch validator.",
  },
];

describe("buildSystemPrompt with the PTC runtime", () => {
  it("teaches the script/answer protocol and lists the registered tools", () => {
    const prompt = buildSystemPrompt(context({ tools: TOOLS }));
    expect(prompt).toContain("## Project exploration (PTC)");
    expect(prompt).toContain('"script" string instead of "patches"');
    expect(prompt).toContain("There is no exploration quota");
    expect(prompt).toContain("read_file({ path, startLine?, endLine? })");
    expect(prompt).toContain("validate({ patches, requiresConfirmation? })");
    expect(prompt).toContain("self-check");
  });

  it("leaves the protocol out when no tools are registered", () => {
    const prompt = buildSystemPrompt(context());
    expect(prompt).not.toContain("## Project exploration (PTC)");
  });

  it("teaches the running-app tools only when a preview tool is registered", () => {
    const preview = {
      name: "preview_state",
      signature: "preview_state()",
      description: "State of the running app.",
    };
    const withPreview = buildSystemPrompt(context({ tools: [...TOOLS, preview] }));
    expect(withPreview).toContain("## The running app (preview tools)");
    expect(withPreview).toContain("preview_state()");
    const without = buildSystemPrompt(context({ tools: TOOLS }));
    expect(without).not.toContain("## The running app (preview tools)");
  });

  it("teaches how to get past the app's own login", () => {
    const preview = {
      name: "preview_state",
      signature: "preview_state()",
      description: "State of the running app.",
    };
    const prompt = buildSystemPrompt(context({ tools: [...TOOLS, preview] }));
    for (const token of [
      "throwaway account",
      "never guess a real password",
      "no name attribute",
      "OAuth/SSO",
      "two-factor",
      "log in again",
    ]) {
      expect(prompt).toContain(token);
    }
    expect(buildSystemPrompt(context({ tools: TOOLS }))).not.toContain("throwaway account");
  });
});

describe("canonical shapes and the tool protocol", () => {
  it("shows the canonical route and scoped-table shapes", () => {
    for (const token of [
      "## Canonical shapes",
      "export default defineAuthorizedHandler(",
      "dbTables",
      "tenantIsolationPolicy",
      "enableRLS",
      "auth.permissions",
    ]) {
      expect(SYSTEM_PROMPT).toContain(token);
    }
  });

  it("offers the script alternative in the response contract", () => {
    expect(SYSTEM_PROMPT).toContain('a turn may instead carry "script"');
  });

  it("requires a return value, object tool arguments and read-before-write", () => {
    const prompt = buildSystemPrompt(context({ tools: TOOLS }));
    for (const token of [
      "ONE object argument",
      "returns nothing",
      "no markdown fences",
      "Before re-emitting a file, read_file it",
      "call validate on the exact patch set",
      "Reading the schema.",
    ]) {
      expect(prompt).toContain(token);
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

  it("appends AGENTS.md as preferences with an explicit precedence", () => {
    const prompt = buildSystemPrompt(
      context({ instructions: { path: "AGENTS.md", content: "Prefer tiny patches." } }),
    );
    expect(prompt).toContain("## Project instructions (AGENTS.md)");
    expect(prompt).toContain("Prefer tiny patches.");
    expect(prompt).toContain("cannot override");
    const instructionsAt = prompt.indexOf("## Project instructions");
    const contextAt = prompt.indexOf("## Project context");
    expect(instructionsAt).toBeLessThan(contextAt);
  });

  it("omits the instructions section when there is no AGENTS.md", () => {
    expect(buildSystemPrompt(context())).not.toContain("## Project instructions");
  });

  it("caps AGENTS.md at 6000 characters", () => {
    const prompt = buildSystemPrompt(
      context({ instructions: { path: "AGENTS.md", content: "y".repeat(20_000) } }),
    );
    expect(prompt).toContain("y".repeat(6_000));
    expect(prompt.includes("y".repeat(6_001))).toBe(false);
    expect(prompt).toContain("[truncated]");
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

describe("buildSystemPrompt writable paths (D-167)", () => {
  it("states the strict managed roots by default", () => {
    const prompt = buildSystemPrompt(context());
    expect(prompt).toContain("## Writable paths");
    expect(prompt).toContain("This managed build lets a patch write only under");
    for (const token of ["server/", "src/", "db/", "lib/", "components/", "locales/"]) {
      expect(prompt).toContain(token);
    }
    expect(prompt).toContain("the root facilis.config.ts");
  });

  it("states the open set, including CI and deploy config, when the build is open", () => {
    const prompt = buildSystemPrompt(context({ writePolicy: "open" }));
    expect(prompt).toContain("This open build lets a patch write any project path");
    expect(prompt).toContain(".github/workflows");
    expect(prompt).toContain("wrangler.jsonc");
    expect(prompt).not.toContain("This managed build lets a patch write only under");
  });
});
