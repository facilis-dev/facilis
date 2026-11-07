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
import { MAX_PATCH_TURNS } from "./patch-set";
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

interface Hooks {
  onScriptStart?: (program: string, turn: number) => void;
  onScript?: (result: PtcRunResult, program: string) => void;
  onPatches?: (part: number, max: number) => void;
}

async function run(
  texts: string[],
  ptc: PtcRunner,
  calls: CallModelInput[],
  hooks: Hooks = {},
) {
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
    ...hooks,
  });
}

const SECOND_FILE: FilePatch = {
  path: "src/second.ts",
  action: "create",
  content: "export const y = 2;\n",
};

function part(patches: FilePatch[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    message: "part",
    patches,
    notes: [],
    requires_confirmation: false,
    ...extra,
  });
}

describe("runTurn with a patch set sent in parts (D-106)", () => {
  it("merges the parts and validates the complete set", async () => {
    const calls: CallModelInput[] = [];
    const seen: { part: number; max: number }[] = [];
    const outcome = await run(
      [part([NEW_FILE], { continue: true }), answer([SECOND_FILE])],
      runner(okRun(null, 0)),
      calls,
      { onPatches: (partNumber, max) => seen.push({ part: partNumber, max }) },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(calls).toHaveLength(2);
    expect(seen).toEqual([{ part: 1, max: MAX_PATCH_TURNS }]);
    expect(outcome.parsed.response.patches).toEqual([NEW_FILE, SECOND_FILE]);
    const continuation = calls[1]?.messages.at(-1)?.content ?? "";
    expect(continuation).toContain("Continue the patch set");
    expect(continuation).toContain("src/new.ts (create)");
  });

  it("keeps the complete patches of a cut-off answer and asks for the rest", async () => {
    const full = part([NEW_FILE, SECOND_FILE]);
    const cut = full.slice(
      0,
      full.indexOf(JSON.stringify(SECOND_FILE)) + JSON.stringify(SECOND_FILE).length,
    );
    expect(() => JSON.parse(cut)).toThrow();

    const calls: CallModelInput[] = [];
    const outcome = await run([cut, answer([])], runner(okRun(null, 0)), calls);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.parsed.response.patches).toEqual([NEW_FILE, SECOND_FILE]);
    expect(calls[1]?.messages.at(-1)?.content).toContain("cut off");
    expect(calls[1]?.messages.at(-1)?.content).toContain("src/second.ts (create)");
  });

  it("stops when the patch set needs more parts than the budget allows", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([part([NEW_FILE], { continue: true })], runner(okRun(null, 0)), calls);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe("parse");
    expect(outcome.failure.message).toContain("more than " + MAX_PATCH_TURNS);
    expect(calls).toHaveLength(MAX_PATCH_TURNS);
  });
});

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

  it("does not spend a repair round on a validator outage", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await runTurn({
      call: capture([answer([NEW_FILE])], calls),
      settings,
      system: "system",
      messages: [{ role: "user", content: "add a file" }],
      host: {
        ...host(),
        analyze: async () => {
          throw new Error("analyzer worker did not become ready");
        },
      },
      signal: SIGNAL,
      onText: () => {},
      onRepair: () => {},
      runner: runner(okRun(null, 0)),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe("validator");
    expect(calls).toHaveLength(1);
  });

  it("reports each program through the start and finish callbacks", async () => {
    const calls: CallModelInput[] = [];
    const started: string[] = [];
    const finished: string[] = [];
    const outcome = await run([script("return 1"), answer([NEW_FILE])], runner(okRun(1)), calls, {
      onScriptStart: (program, turn) => started.push(turn + ":" + program),
      onScript: (result, program) => finished.push(program + ":" + String(result.ok)),
    });

    expect(outcome.ok).toBe(true);
    expect(started).toEqual(["1:return 1"]);
    expect(finished).toEqual(["return 1:true"]);
  });

  it("tells the model when a program returned nothing", async () => {
    const calls: CallModelInput[] = [];
    const outcome = await run([script("await tools.list_files({})"), answer([NEW_FILE])], runner(okRun(null, 1)), calls);
    expect(outcome.ok).toBe(true);
    expect(calls[1]?.messages.at(-1)?.content).toContain("returned no value");
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
