import { describe, expect, it } from "vitest";
import type { ChatTraceCall } from "./types";
import { ChatSession } from "./chat-session";
import {
  answer,
  createNewFile,
  EMPTY_RUNNER,
  fakeHost,
  root,
  sessionWith,
  settings,
} from "./chat-session-fixtures";

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
      runner: EMPTY_RUNNER,
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
      runner: EMPTY_RUNNER,
    });

    await chat.send("hi");
    expect(seenPartial).toBe("Hel");
    expect(seenStreaming).toBe(true);
    const state = chat.getSnapshot();
    expect(state.streaming).toBe(false);
    expect(state.messages.at(-1)?.content).toBe("Hello there");
    expect(state.messages.at(-1)?.role).toBe("assistant");
  });

  it("drops the partial bubble when the first answer cannot be parsed", async () => {
    let calls = 0;
    const chat = sessionWith(async (input) => {
      calls += 1;
      if (calls === 1) {
        input.onText?.('{"message":"partial');
        return { ok: true, text: "not json at all" };
      }
      return { ok: true, text: answer(createNewFile()) };
    });
    await chat.send("hi");
    const state = chat.getSnapshot();
    expect(state.streaming).toBe(false);
    expect(state.error).toBeNull();
    expect(state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(state.messages.some((message) => message.content.includes("partial"))).toBe(false);
    expect(state.proposal).not.toBeNull();
  });

  it("keeps asking for a usable answer instead of failing the turn (D-108)", async () => {
    let calls = 0;
    const chat = sessionWith(async () => {
      calls += 1;
      return calls < 3
        ? { ok: true, text: "sorry, no JSON" }
        : { ok: true, text: answer(createNewFile()) };
    });
    await chat.send("add");
    const state = chat.getSnapshot();
    expect(calls).toBe(3);
    expect(state.error).toBeNull();
    expect(state.proposal).not.toBeNull();
  });

  it("folds consecutive user turns after a failed answer so roles alternate", async () => {
    const calls: { messages: readonly { role: string; content: string }[] }[] = [];
    let first = true;
    const chat = sessionWith(async (input) => {
      calls.push(input);
      if (first) {
        first = false;
        return { ok: false, failure: { kind: "network", message: "offline" } };
      }
      return { ok: true, text: answer(createNewFile()) };
    });

    await chat.send("first request");
    expect(chat.getSnapshot().error?.kind).toBe("network");
    await chat.send("second request");

    // The failed turn never became an assistant bubble; the replay keeps roles alternating.
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
      runner: EMPTY_RUNNER,
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
        runner: EMPTY_RUNNER,
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
        runner: EMPTY_RUNNER,
      },
    );
    await chat.openInstructions();
    expect(harness.writes).toEqual([]);
    expect(opened).toEqual(["AGENTS.md"]);
  });

  it("streams the reasoning into the state and keeps it on the activity row (D-110)", async () => {
    const live: (string | null)[] = [];
    const chat = sessionWith(async (input) => {
      input.onReasoning?.("first ");
      input.onReasoning?.("thought");
      live.push(chat.getSnapshot().reasoning);
      return { ok: true, text: answer(createNewFile()), reasoning: "first thought" };
    });
    await chat.send("add");
    const state = chat.getSnapshot();
    expect(live).toEqual(["first thought"]);
    expect(state.reasoning).toBeNull();
    expect(state.trace).toEqual([]);
    const activity = state.messages[0]?.activity ?? [];
    const calls = activity.filter((entry): entry is ChatTraceCall => entry.kind === "call");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ n: 1, outcome: "answer" });
    expect(calls[0]?.reasoning).toBe("first thought");
  });
});
