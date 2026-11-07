import { describe, expect, it } from "vitest";
import type { FilePatch } from "@facilis/ai";
import { analyzeHostFiles } from "./analysis-fixtures";
import { ChatSession, type ChatHost, type ModelCall } from "./chat-session";
import type { AiSettings } from "./types";

const root = "/home/user/project";

const settings: AiSettings = {
  providerId: "custom",
  apiKey: "sk-test",
  model: "test-model",
  baseUrl: "http://provider.test/v1",
};

function answer(patch?: FilePatch): string {
  return JSON.stringify({
    message: "Here is the change.",
    patches: patch ? [patch] : [],
    notes: ["A note"],
    requires_confirmation: false,
  });
}

interface Harness {
  host: ChatHost;
  writes: string[];
}

function fakeHost(): Harness {
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

function sessionWith(call: ModelCall, host: ChatHost = fakeHost().host): ChatSession {
  return new ChatSession(host, {
    call,
    loadSettings: () => settings,
    saveSettings: () => {},
    now: () => 1,
  });
}

function createNewFile(): FilePatch {
  return { path: "src/new.ts", action: "create", content: "x\n" };
}

describe("ChatSession", () => {
  it("turns an answer into a reviewable proposal without writing", async () => {
    const harness = fakeHost();
    let system = "";
    let turns = 0;
    const chat = new ChatSession(harness.host, {
      call: async (input) => {
        system = input.system;
        turns = input.messages.length;
        return { ok: true, text: answer(createNewFile()) };
      },
      loadSettings: () => settings,
      saveSettings: () => {},
      now: () => 1,
    });

    await chat.send("  add a file  ");
    const state = chat.getSnapshot();
    expect(state.phase).toBe("idle");
    expect(state.messages.map((message) => message.content)).toEqual([
      "add a file",
      "Here is the change.",
    ]);
    expect(turns).toBe(1);
    expect(system).toContain("## Project context");
    expect(state.proposal?.files).toHaveLength(1);
    expect(state.proposal?.files[0]?.before).toBeNull();
    expect(state.proposal?.files[0]?.accepted).toBe(true);
    expect(state.proposal?.files[0]?.added).toBe(1);
    expect(state.proposal?.notes).toEqual(["A note"]);
    expect(state.proposal?.warnings).toEqual([]);
    expect(harness.writes).toEqual([]);
  });

  it("applies only the accepted files and keeps an undo plan", async () => {
    const harness = fakeHost();
    const chat = sessionWith(
      async () => ({ ok: true, text: answer(createNewFile()) }),
      harness.host,
    );
    await chat.send("add");
    await chat.apply();

    const state = chat.getSnapshot();
    expect(harness.writes).toEqual(["vv-write:" + root + "/src/new.ts"]);
    expect(state.applied).toMatchObject({ kind: "apply", ok: true });
    expect(state.proposal).toBeNull();
    expect(state.undo).toEqual({ entries: [{ path: "src/new.ts", content: null }] });

    await chat.undo();
    expect(harness.writes).toEqual([
      "vv-write:" + root + "/src/new.ts",
      "vv-rm:" + root + "/src/new.ts",
    ]);
    expect(chat.getSnapshot().applied).toMatchObject({ kind: "undo", ok: true });
    expect(chat.getSnapshot().undo).toBeNull();
  });

  it("does not write when the user unchecks every file", async () => {
    const harness = fakeHost();
    const chat = sessionWith(
      async () => ({ ok: true, text: answer(createNewFile()) }),
      harness.host,
    );
    await chat.send("add");
    chat.toggleFile("src/new.ts");
    await chat.apply();
    expect(harness.writes).toEqual([]);
    expect(chat.getSnapshot().applied).toBeNull();
  });

  it("streams the message field into a bubble before the answer completes", async () => {
    let clock = 0;
    let seenPartial: string | null = null;
    let seenStreaming = false;
    const chat: ChatSession = new ChatSession(fakeHost().host, {
      call: async (input) => {
        input.onText?.('{"message":"Hel');
        seenPartial = chat.getSnapshot().messages.at(-1)?.content ?? null;
        seenStreaming = chat.getSnapshot().streaming;
        input.onText?.('lo there"}');
        return {
          ok: true,
          text: '{"message":"Hello there","patches":[],"notes":[],"requires_confirmation":false}',
        };
      },
      loadSettings: () => settings,
      saveSettings: () => {},
      now: () => (clock += 1000),
    });

    await chat.send("hi");
    expect(seenPartial).toBe("Hel");
    expect(seenStreaming).toBe(true);
    const state = chat.getSnapshot();
    expect(state.streaming).toBe(false);
    expect(state.messages.at(-1)?.content).toBe("Hello there");
    expect(state.messages.at(-1)?.role).toBe("assistant");
  });

  it("drops the partial bubble when the answer cannot be parsed", async () => {
    const chat = sessionWith(async (input) => {
      input.onText?.('{"message":"partial');
      return { ok: true, text: "not json at all" };
    });
    await chat.send("hi");
    const state = chat.getSnapshot();
    expect(state.messages).toHaveLength(1);
    expect(state.streaming).toBe(false);
    expect(state.error?.kind).toBe("parse");
  });

  it("reports an unusable answer as a parse failure and keeps the turn", async () => {
    const chat = sessionWith(async () => ({ ok: true, text: "sorry, no JSON" }));
    await chat.send("add");
    const state = chat.getSnapshot();
    expect(state.error?.kind).toBe("parse");
    expect(state.messages).toHaveLength(1);
    expect(state.proposal).toBeNull();
  });

  it("folds consecutive user turns after a failed answer so roles alternate", async () => {
    const calls: { messages: readonly { role: string; content: string }[] }[] = [];
    const chat = sessionWith(async (input) => {
      calls.push(input);
      // Keep failing until the second user request (the repair turns still name the first).
      const second = input.messages.some(
        (turn) => turn.role === "user" && turn.content.includes("second request"),
      );
      return second
        ? { ok: true, text: answer(createNewFile()) }
        : { ok: true, text: "not json" };
    });

    await chat.send("first request");
    expect(chat.getSnapshot().error?.kind).toBe("parse");
    await chat.send("second request");

    // The failed turn never became an assistant bubble; Anthropic requires alternating roles.
    const replayed = calls.at(-1)?.messages ?? [];
    expect(replayed.map((turn) => turn.role)).toEqual(["user"]);
    expect(replayed[0]?.content).toContain("first request");
    expect(replayed[0]?.content).toContain("second request");
    expect(chat.getSnapshot().error).toBeNull();
  });

  it("surfaces a provider failure with its kind and status", async () => {
    const chat = sessionWith(async () => ({
      ok: false,
      failure: { kind: "http", status: 401, message: "invalid api key" },
    }));
    await chat.send("add");
    expect(chat.getSnapshot().error).toEqual({
      kind: "http",
      status: 401,
      message: "invalid api key",
    });
  });

  it("refuses to send without a configured provider", async () => {
    let called = false;
    const chat = new ChatSession(fakeHost().host, {
      call: async () => {
        called = true;
        return { ok: true, text: answer() };
      },
      loadSettings: () => null,
      saveSettings: () => {},
      now: () => 1,
    });
    await chat.send("add");
    expect(called).toBe(false);
    expect(chat.getSnapshot().error?.kind).toBe("unsupported");
  });

  it("creates and opens AGENTS.md from the project instructions action", async () => {
    const harness = fakeHost();
    const opened: string[] = [];
    const chat = new ChatSession(
      { ...harness.host, openFile: (path) => opened.push(path) },
      {
        call: async () => ({ ok: true, text: answer() }),
        loadSettings: () => settings,
        saveSettings: () => {},
        now: () => 1,
      },
    );
    await chat.openInstructions();
    expect(harness.writes).toEqual(["vv-write:" + root + "/AGENTS.md"]);
    expect(opened).toEqual(["AGENTS.md"]);
  });

  it("opens an existing AGENTS.md without rewriting it", async () => {
    const harness = fakeHost();
    const opened: string[] = [];
    const chat = new ChatSession(
      {
        ...harness.host,
        read: async (path) => (path === "AGENTS.md" ? "# ours\n" : ""),
        openFile: (path) => opened.push(path),
      },
      {
        call: async () => ({ ok: true, text: answer() }),
        loadSettings: () => settings,
        saveSettings: () => {},
        now: () => 1,
      },
    );
    await chat.openInstructions();
    expect(harness.writes).toEqual([]);
    expect(opened).toEqual(["AGENTS.md"]);
  });
});
