import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis/ai";
import { analyzeHostFiles } from "./analysis-fixtures";
import type { CallModelInput } from "./client";
import type { PatchValidationHost } from "./patch-validation";
import {
  MAX_SCRIPT_TURNS,
  type PtcRunner,
  type PtcRunResult,
  type PtcToolSpec,
} from "./ptc/protocol";
import { runTurn } from "./turn";
import type { AiSettings } from "./types";

const settings: AiSettings = {
  providerId: "custom",
  apiKey: "sk-test",
  model: "test-model",
  baseUrl: "http://provider.test/v1",
};

const NEW_FILE: FilePatch = { path: "src/new.ts", action: "create", content: "export const x = 1;\n" };

const ROUTE: FilePatch = {
  path: "server/routes/api/ping.get.ts",
  action: "create",
  content:
    'import { defineAuthorizedHandler } from "@facilis/core";\n\n' +
    'export default defineAuthorizedHandler({ permission: ["todos:write"], dbTables: [] }, async () => null);\n',
};

function answer(patches: FilePatch[] = []): string {
  return JSON.stringify({
    message: "Here is the change.",
    patches,
    notes: [],
    requires_confirmation: false,
  });
}

function script(program: string): string {
  return JSON.stringify({
    message: "Let me look.",
    script: program,
    notes: [],
    requires_confirmation: false,
  });
}

const FILES = ["facilis.config.ts", "db/schema.ts", "package.json", "locales/en.json", "tsconfig.json"];
const CONFIG = `import { defineConfig } from "@facilis/core";

export default defineConfig({
  auth: { permissions: ["todos:read"], roles: { admin: ["*"] }, defaultRole: "admin" },
});
`;

function host(): PatchValidationHost {
  const read = async (path: string) => {
    if (path === "facilis.config.ts") return CONFIG;
    if (path === "db/schema.ts") return "export {};\n";
    if (path === "package.json") {
      return JSON.stringify({ dependencies: { "@facilis/core": "workspace:*" } });
    }
    if (path === "locales/en.json" || path === "tsconfig.json") return "{}";
    return "";
  };
  return {
    files: () => FILES,
    read,
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    analyze: (patches) => analyzeHostFiles(FILES, read, patches),
  };
}

const SPEC: PtcToolSpec = { name: "list_files", signature: "list_files({ dir? })", description: "List files." };

function runner(result: PtcRunResult | ((program: string) => PtcRunResult)): PtcRunner {
  return {
    specs: () => [SPEC],
    run: async (program) => (typeof result === "function" ? result(program) : result),
    dispose: () => {},
  };
}

function okRun(value: unknown, calls = 1): PtcRunResult {
  return {
    ok: true,
    value: value as PtcRunResult["value"],
    toolCalls: calls,
    elapsedMs: 3,
    trace: [{ name: "list_files", args: "{}", ok: true, durationMs: 2, bytes: 12 }],
  };
}

function capture(texts: string[], calls: CallModelInput[], onTurn?: (call: number) => void): (input: CallModelInput) => Promise<{ ok: true; text: string }> {
  return async (input) => {
    calls.push(input);
    onTurn?.(calls.length);
    const text = texts[Math.min(calls.length - 1, texts.length - 1)] ?? texts.at(-1) ?? "";
    return { ok: true, text };
  };
}

const SIGNAL = new AbortController().signal;

async function run(texts: string[], ptc: PtcRunner | null, calls: CallModelInput[]) {
  return runTurn({
    call: capture(texts, calls),
    settings,
    system: "system",
    messages: [{ role: "user", content: "add a file" }],
    host: host(),
    signal: SIGNAL,
    onText: () => {},
    onRepair: () => {},
    runner: ptc,
  });
}

describe("runTurn with PTC exploration", () => {
  it("runs a program, returns its result to the model, then accepts the final answer", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([script("return await tools.list_files({})"), answer([NEW_FILE])], runner(okRun({ files: ["src/a.ts"] })), calls);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    const resultTurn = calls[1]?.messages.at(-1)?.content ?? "";
    expect(resultTurn).toContain("The program finished");
    expect(resultTurn).toContain("src/a.ts");
    expect(resultTurn).toContain("list_files");
    expect(outcome.parsed.response.patches).toEqual([NEW_FILE]);
    expect(outcome.trace).toHaveLength(1);
  });

  it("rejects a program when the runtime is off", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([script("return 1")], null, calls);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe("parse");
    expect(outcome.failure.message).toContain("not available");
    expect(calls).toHaveLength(1);
  });

  it("feeds a failed program back as data and lets the model recover", async () => {
    const calls: CallModelInput[] = [];
    const timeout: PtcRunResult = {
      ok: false,
      error: { kind: "timeout", message: "the program exceeded 5000ms" },
      toolCalls: 0,
      elapsedMs: 5000,
      trace: [],
    };
    const outcome = await run([script("while (true) {}"), answer([NEW_FILE])], runner(timeout), calls);
    expect(outcome.ok).toBe(true);
    const resultTurn = calls[1]?.messages.at(-1)?.content ?? "";
    expect(resultTurn).toContain("timeout");
    expect(resultTurn).toContain("5000ms");
  });

  it("stops after the program budget", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([script("return 1")], runner(okRun(1)), calls);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.message).toContain("exploration budget");
    expect(calls).toHaveLength(MAX_SCRIPT_TURNS + 1);
  });

  it("does not inline file content in a repair when the tools are available", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([answer([ROUTE]), answer([NEW_FILE])], runner(okRun(null, 0)), calls);
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const repair = calls[1]?.messages.at(-1)?.content ?? "";
    expect(repair).toContain("## Validation findings");
    expect(repair).toContain("## Tools");
    expect(repair).not.toContain("## Current content of the files");
  });
});
