import { describe, expect, it } from "vitest";
import { ChatSession } from "./chat-session";
import { COMPACTION_SYSTEM, replayWithSummary } from "./chat-compaction";
import type { CallModelInput } from "./client";
import { answer, EMPTY_RUNNER, fakeHost, sessionWith } from "./chat-session-fixtures";
import type { ChatMessage } from "./types";

const SUMMARY = "Goal: add a route. Changed src/App.tsx. Open: tests.";

function message(id: string, role: ChatMessage["role"], content: string): ChatMessage {
  return { id, role, content, at: 1 };
}

describe("ChatSession.compact", () => {
  it("stores the summary and replays it instead of the covered messages", async () => {
    const calls: CallModelInput[] = [];
    const chat = sessionWith(async (input) => {
      calls.push(input);
      return input.system === COMPACTION_SYSTEM
        ? { ok: true, text: SUMMARY }
        : { ok: true, text: answer() };
    });

    await chat.send("first request");
    await chat.send("second request");
    await chat.compact();

    const state = chat.getSnapshot();
    expect(state.phase).toBe("idle");
    expect(state.error).toBeNull();
    expect(state.summary).toEqual({ content: SUMMARY, at: 1, through: 4 });
    // Compaction never hides the transcript: the covered messages stay visible.
    expect(state.messages.map((entry) => entry.content)).toEqual([
      "first request",
      "Here is the change.",
      "second request",
      "Here is the change.",
    ]);

    // The summarizer read the whole conversation in one plain-text call.
    const compaction = calls.at(-1);
    expect(compaction?.system).toBe(COMPACTION_SYSTEM);
    expect(compaction?.messages).toEqual([
      { role: "user", content: "first request" },
      { role: "assistant", content: "Here is the change." },
      { role: "user", content: "second request" },
      { role: "assistant", content: "Here is the change." },
    ]);

    await chat.send("third request");
    const replay = calls.at(-1)?.messages ?? [];
    expect(replay).toHaveLength(1);
    expect(replay[0]?.role).toBe("user");
    expect(replay[0]?.content).toContain(SUMMARY);
    expect(replay[0]?.content).toContain("third request");
    expect(replay[0]?.content).not.toContain("first request");
  });

  it("feeds an existing summary into the next compaction and moves the coverage", async () => {
    const calls: CallModelInput[] = [];
    const chat = sessionWith(async (input) => {
      calls.push(input);
      return input.system === COMPACTION_SYSTEM
        ? { ok: true, text: SUMMARY }
        : { ok: true, text: answer() };
    });

    await chat.send("first request");
    await chat.compact();
    await chat.send("second request");
    expect(chat.getSnapshot().summary?.through).toBe(2);

    await chat.compact();
    const second = calls.at(-1);
    expect(second?.system).toBe(COMPACTION_SYSTEM);
    expect(second?.messages[0]?.role).toBe("user");
    expect(second?.messages[0]?.content).toContain(SUMMARY);
    expect(second?.messages[0]?.content).toContain("second request");
    expect(chat.getSnapshot().summary?.through).toBe(4);
  });

  it("keeps the previous summary and surfaces a failed compaction", async () => {
    let failing = false;
    const chat = sessionWith(async (input) => {
      if (input.system !== COMPACTION_SYSTEM) return { ok: true, text: answer() };
      return failing
        ? { ok: false, failure: { kind: "http", status: 500, message: "provider exploded" } }
        : { ok: true, text: SUMMARY };
    });

    await chat.send("first request");
    await chat.compact();
    const kept = chat.getSnapshot().summary;

    failing = true;
    await chat.send("second request");
    await chat.compact();

    const state = chat.getSnapshot();
    expect(state.summary).toEqual(kept);
    expect(state.error).toEqual({
      kind: "http",
      status: 500,
      message: "provider exploded",
    });
    expect(state.phase).toBe("idle");
  });

  it("treats an empty summary as a failure without clearing the old one", async () => {
    const chat = sessionWith(async (input) =>
      input.system === COMPACTION_SYSTEM ? { ok: true, text: "   " } : { ok: true, text: answer() },
    );
    await chat.send("first request");
    await chat.compact();
    expect(chat.getSnapshot().summary).toBeNull();
    expect(chat.getSnapshot().error?.kind).toBe("empty");
  });

  it("is busy while compacting, blocks sends and cancels like a turn", async () => {
    const calls: CallModelInput[] = [];
    let aborted = false;
    const chat = sessionWith(async (input) => {
      calls.push(input);
      if (input.system !== COMPACTION_SYSTEM) return { ok: true, text: answer() };
      return new Promise((resolve) => {
        input.signal?.addEventListener("abort", () => {
          aborted = true;
          resolve({
            ok: false,
            failure: { kind: "aborted", message: "The request was cancelled." },
          });
        });
      });
    });

    await chat.send("hello");
    const running = chat.compact();
    expect(chat.getSnapshot().phase).toBe("compacting");
    const before = calls.length;
    await chat.send("ignored while compacting");
    expect(calls).toHaveLength(before);

    chat.cancel();
    await running;
    expect(aborted).toBe(true);
    const state = chat.getSnapshot();
    expect(state.phase).toBe("idle");
    expect(state.error?.kind).toBe("aborted");
    expect(state.summary).toBeNull();
  });

  it("does not re-summarize a transcript the current summary already covers", async () => {
    let compactionCalls = 0;
    const chat = sessionWith(async (input) => {
      if (input.system !== COMPACTION_SYSTEM) return { ok: true, text: answer() };
      compactionCalls += 1;
      return { ok: true, text: SUMMARY };
    });

    await chat.send("first request");
    await chat.compact();
    const callsAfterFirst = compactionCalls;
    await chat.compact();

    expect(compactionCalls).toBe(callsAfterFirst);
    expect(chat.getSnapshot().phase).toBe("idle");
  });

  it("does nothing without a conversation", async () => {
    let called = 0;
    const chat = sessionWith(async () => {
      called += 1;
      return { ok: true, text: answer() };
    });
    await chat.compact();
    expect(called).toBe(0);
    expect(chat.getSnapshot().summary).toBeNull();
    expect(chat.getSnapshot().error).toBeNull();
  });

  it("refuses to compact without a configured provider", async () => {
    let called = 0;
    const chat = new ChatSession(fakeHost().host, {
      call: async () => {
        called += 1;
        return { ok: true, text: answer() };
      },
      loadSettings: () => null,
      saveSettings: () => {},
      now: () => 1,
      runner: EMPTY_RUNNER,
    });
    await chat.compact();
    expect(called).toBe(0);
    expect(chat.getSnapshot().error?.kind).toBe("unsupported");
  });
});

describe("replayWithSummary", () => {
  it("still caps the replayed messages at the limit", () => {
    const messages: ChatMessage[] = [
      message("user-1", "user", "old request"),
      message("assistant-1", "assistant", "old answer"),
    ];
    for (let index = 0; index < 25; index += 1) {
      messages.push(message("user-" + index, "user", "turn " + index));
      messages.push(message("assistant-" + index, "assistant", "answer " + index));
    }
    const turns = replayWithSummary(
      messages,
      { content: "compressed history", at: 1, through: 2 },
      20,
    );
    expect(turns).toHaveLength(20);
    expect(turns[0]?.content).toContain("compressed history");
    expect(turns[0]?.content).toContain("turn 15");
    expect(turns.at(-1)?.content).toBe("answer 24");
  });

  it("is the plain replay when there is no summary", () => {
    const messages: ChatMessage[] = [
      message("user-1", "user", "one"),
      message("assistant-1", "assistant", "two"),
    ];
    expect(replayWithSummary(messages, null, 20)).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
    ]);
  });
});
