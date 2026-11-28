// Shared fixtures for the SPEC §9.4 turn-loop tests (turn.test.ts, turn-parts.test.ts).
//
// Not a test file: vitest collects only *.test.ts, so both suites import these helpers and
// stay under the 300-line limit.

import { analyzeHostFiles } from "./analysis-fixtures";
import type { CallModelInput } from "./client";
import type { PatchValidationHost } from "./patch-validation";
import type { PtcRunner, PtcRunResult, PtcToolSpec } from "./ptc/protocol";
import type { ChatWrites } from "./chat-writes";
import { runTurn } from "./turn";
import type { PreviewAccess } from "./preview-access";
import type { AiSettings, ChatTraceCall } from "./types";

export const settings: AiSettings = {
  providerId: "custom",
  apiKey: "sk-test",
  model: "test-model",
  baseUrl: "http://provider.test/v1",
};

/** A valid final answer: the summary and nothing else (D-192). */
export function answer(): string {
  return JSON.stringify({ message: "Here is the change." });
}

/** The old shape, which the parser must reject: source never travels in the answer. */
export function patchedAnswer(): string {
  return JSON.stringify({
    message: "Here is the patch.",
    patches: [{ path: "src/new.ts", action: "create", content: "export const x = 1;\n" }],
  });
}

export function script(program: string): string {
  return JSON.stringify({ message: "Let me look.", script: program });
}

const FILES = [
  "facilis.config.ts",
  "db/schema.ts",
  "package.json",
  "locales/en.json",
  "tsconfig.json",
];
const CONFIG = `import { defineConfig } from "@facilis.dev/core";

export default defineConfig({
  auth: { permissions: ["todos:read"], roles: { admin: ["*"] }, defaultRole: "admin" },
});
`;

export function host(): PatchValidationHost {
  const read = async (path: string) => {
    if (path === "facilis.config.ts") return CONFIG;
    if (path === "db/schema.ts") return "export {};\n";
    if (path === "package.json") {
      return JSON.stringify({ dependencies: { "@facilis.dev/core": "workspace:*" } });
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

const SPEC: PtcToolSpec = {
  name: "list_files",
  signature: "list_files({ dir? })",
  description: "List files.",
};

export function runner(result: PtcRunResult | ((program: string) => PtcRunResult)): PtcRunner {
  return {
    specs: () => [SPEC],
    run: async (program) => (typeof result === "function" ? result(program) : result),
    dispose: () => {},
  };
}

/** A write engine that records nothing: the turn loop only needs it to be in write mode. */
export function fakeWrites(): ChatWrites {
  return {
    beginTurn() {},
    writeFile: async () => ({
      ok: true,
      path: "src/a.ts",
      action: "create",
      bytes: 1,
      destructive: false,
      added: 1,
      removed: 0,
    }),
    deleteFile: async () => ({
      ok: true,
      path: "src/a.ts",
      action: "delete",
      bytes: 0,
      destructive: false,
      added: 0,
      removed: 1,
    }),
    turnWrites: () => [],
    takeGateFailure: () => null,
    takeSchemaConfirmation: () => null,
    applyPending: async () => ({ ok: false, path: "", errors: [], warnings: [] }),
    takeSurfaceConfirmation: () => null,
    applyPendingSurface: async () => ({ ok: false, path: "", errors: [], warnings: [] }),
    discardPendingSurface() {},
    outage: () => false,
    undoTurn: async () => ({ ok: true, errors: [] }),
  };
}

export function okRun(value: unknown, calls = 1): PtcRunResult {
  return {
    ok: true,
    value: value as PtcRunResult["value"],
    toolCalls: calls,
    elapsedMs: 3,
    trace: [{ name: "list_files", args: "{}", ok: true, durationMs: 2, bytes: 12 }],
  };
}

export function capture(
  texts: string[],
  calls: CallModelInput[],
  onTurn?: (call: number) => void,
): (input: CallModelInput) => Promise<{ ok: true; text: string }> {
  return async (input) => {
    calls.push(input);
    onTurn?.(calls.length);
    const text = texts[Math.min(calls.length - 1, texts.length - 1)] ?? texts.at(-1) ?? "";
    return { ok: true, text };
  };
}

export const SIGNAL = new AbortController().signal;

export interface Hooks {
  onScriptStart?: (program: string, turn: number) => void;
  onScript?: (result: PtcRunResult, program: string, images: readonly string[]) => void;
  onPatches?: (part: number) => void;
  onReasoning?: (chunk: string) => void;
  onCallStart?: (call: number) => void;
  onCall?: (call: ChatTraceCall) => void;
}

/** A preview host for the turn-loop tests: available, empty answers, no screenshots. */
export function previewAccess(overrides: Partial<PreviewAccess> = {}): PreviewAccess {
  return {
    available: () => true,
    state: async () => ({}),
    console: () => ({}),
    network: () => ({}),
    dom: async () => ({}),
    click: async () => ({}),
    fill: async () => ({}),
    open: async () => ({}),
    wait: async () => ({}),
    screenshot: async () => ({}),
    takeImages: () => [],
    ...overrides,
  };
}

export interface RunOptions extends Hooks {
  /** Replaces the plain validation host, e.g. to add a preview (D-112). */
  preview?: PreviewAccess;
  /** Puts the loop in write mode: the write tools are the only source-change path (D-191). */
  writes?: ChatWrites;
}

export async function run(
  texts: string[],
  ptc: PtcRunner,
  calls: CallModelInput[],
  options: RunOptions = {},
) {
  const { preview, writes, ...hooks } = options;
  return runTurn({
    call: capture(texts, calls),
    settings,
    system: "system",
    messages: [{ role: "user", content: "add a file" }],
    host: preview === undefined ? host() : { ...host(), preview },
    signal: SIGNAL,
    onText: () => {},
    onRepair: () => {},
    runner: ptc,
    ...(writes === undefined ? {} : { writes }),
    ...hooks,
  });
}
