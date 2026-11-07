import { describe, expect, it } from "vitest";
import { analyzeHostFiles } from "./analysis-fixtures";
import { ChatSession, type ChatHost } from "./chat-session";
import type { CallModelInput } from "./client";
import type { PtcRunner } from "./ptc/protocol";
import type { AiSettings } from "./types";

const root = "/home/user/project";

const settings: AiSettings = {
  providerId: "custom",
  apiKey: "sk-test",
  model: "test-model",
  baseUrl: "http://provider.test/v1",
};

function answer(): string {
  return JSON.stringify({
    message: "Here is the change.",
    patches: [{ path: "src/new.ts", action: "create", content: "x\n" }],
    notes: [],
    requires_confirmation: false,
  });
}

function fakeHost(): ChatHost {
  const files = () => ["facilis.config.ts", "src/App.tsx"];
  const read = async (path: string) =>
    path === "src/App.tsx" ? "export const App = () => null;\n" : "";
  return {
    root: () => root,
    bridge: { async request() { return { ok: true }; } },
    files,
    read,
    analyze: (patches) => analyzeHostFiles(files(), read, patches),
    activeFile: async () => null,
    manifestBase: () => null,
    syntaxChecker: () => ({ check: async () => [] }),
    openFile: () => {},
  };
}

describe("ChatSession with the PTC runtime", () => {
  it("passes the tool specs into the system prompt and accepts an exploration turn", async () => {
    const calls: CallModelInput[] = [];
    const spec = { name: "read_file", signature: "read_file({ path })", description: "Read one file." };
    const runner: PtcRunner = {
      specs: () => [spec],
      run: async () => ({
        ok: true,
        value: { file: "src/App.tsx" },
        toolCalls: 1,
        elapsedMs: 1,
        trace: [{ name: "read_file", args: "{}", ok: true, durationMs: 1, bytes: 2 }],
      }),
      dispose: () => {},
    };
    const chat = new ChatSession(fakeHost(), {
      call: async (input) => {
        calls.push(input);
        const text =
          calls.length === 1
            ? JSON.stringify({
                message: "Let me look.",
                script: "return await tools.read_file({ path: 'src/App.tsx' });",
                notes: [],
                requires_confirmation: false,
              })
            : answer();
        return { ok: true, text };
      },
      loadSettings: () => settings,
      saveSettings: () => {},
      now: () => 1,
      runner,
    });

    await chat.send("add a file");
    expect(calls[0]?.system).toContain("## Project exploration (PTC)");
    expect(calls[0]?.system).toContain("read_file({ path })");
    expect(calls).toHaveLength(2);
    const state = chat.getSnapshot();
    expect(state.error).toBeNull();
    expect(state.exploring).toBeNull();
    expect(state.trace).toHaveLength(1);
    expect(state.trace[0]).toMatchObject({
      program: "return await tools.read_file({ path: 'src/App.tsx' });",
      ok: true,
      toolCalls: 1,
    });
    expect(state.trace[0]?.entries[0]?.name).toBe("read_file");
    expect(state.proposal?.files[0]?.patch).toEqual({
      path: "src/new.ts",
      action: "create",
      content: "x\n",
    });
  });
});
