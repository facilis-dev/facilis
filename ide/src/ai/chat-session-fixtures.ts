// Shared fixtures for the ChatSession suites (chat-session.test.ts and any test that needs
// the same fake host/settings). Not a test file: vitest collects only *.test.ts.

import type { FilePatch } from "@facilis.dev/ai";
import { ChatSession, type ChatHost, type ModelCall } from "./chat-session";
import { analyzeHostFiles } from "./analysis-fixtures";
import type { PtcRunner } from "./ptc/protocol";
import type { AiSettings } from "./types";

/** The chat has no non-PTC mode (D-103); these sessions never explore, so specs are empty. */
export const EMPTY_RUNNER: PtcRunner = {
  specs: () => [],
  run: async () => ({ ok: true, value: null, toolCalls: 0, elapsedMs: 0, trace: [] }),
  dispose: () => {},
};

export const root = "/home/user/project";

export const settings: AiSettings = {
  providerId: "custom",
  apiKey: "sk-test",
  model: "test-model",
  baseUrl: "http://provider.test/v1",
};

export function answer(patch?: FilePatch): string {
  return JSON.stringify({
    message: "Here is the change.",
    patches: patch ? [patch] : [],
    notes: ["A note"],
    requires_confirmation: false,
  });
}

export interface Harness {
  host: ChatHost;
  writes: string[];
}

export function fakeHost(): Harness {
  const writes: string[] = [];
  const files = () => ["facilis.config.ts", "src/App.tsx"];
  const read = async (path: string) =>
    path === "src/App.tsx"
      ? "export const App = () => null;\n"
      : path === "facilis.config.ts"
        ? "export default {};\n"
        : "";
  return {
    writes,
    host: {
      root: () => root,
      bridge: {
        async request(type, extra) {
          writes.push(type + ":" + String(extra?.path ?? ""));
          return { ok: true };
        },
      },
      files,
      read,
      analyze: (patches) => analyzeHostFiles(files(), read, patches),
      activeFile: async () => null,
      manifestBase: () => null,
      // Rule 1's parser in unit tests: no syntax findings (the fake VFS has no project).
      syntaxChecker: () => ({ check: async () => [] }),
      openFile: () => {},
    },
  };
}

export function sessionWith(call: ModelCall, host: ChatHost = fakeHost().host): ChatSession {
  return new ChatSession(host, {
    call,
    loadSettings: () => settings,
    saveSettings: () => {},
    now: () => 1,
    runner: EMPTY_RUNNER,
  });
}

export function createNewFile(): FilePatch {
  return { path: "src/new.ts", action: "create", content: "x\n" };
}
