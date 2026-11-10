// Strict time order (owner report 2026-11-10): when a turn ends its activity is snapshotted
// onto the user message that opened it and the live trace is cleared, so the transcript can
// keep a finished turn in place across later turns. The ordering itself is covered by
// transcript-entries.test.ts; this suite covers the session's state transitions.

import { describe, expect, it } from "vitest";
import { transcriptEntries, transcriptEntryKey } from "./transcript-entries";
import type { ChatActivity, ChatTraceCall } from "./types";
import { answer, createNewFile, sessionWith } from "./chat-session-fixtures";

function callsOf(activity: readonly ChatActivity[] | undefined): ChatTraceCall[] {
  return (activity ?? []).filter((entry): entry is ChatTraceCall => entry.kind === "call");
}

describe("ChatSession turn activity", () => {
  it("moves the turn's trace onto the user message and clears the live trace", async () => {
    const chat = sessionWith(async () => ({ ok: true, text: answer(createNewFile()) }));
    await chat.send("add a file");

    const state = chat.getSnapshot();
    expect(state.trace).toEqual([]);
    expect(state.messages[0]?.role).toBe("user");
    expect(callsOf(state.messages[0]?.activity).map((call) => call.outcome)).toEqual(["answer"]);
    // The answer bubble has no activity of its own: it is the end of the user's turn.
    expect(state.messages[1]?.activity).toBeUndefined();
  });

  it("keeps a finished turn's activity in place across later turns", async () => {
    const chat = sessionWith(async () => ({ ok: true, text: answer() }));
    await chat.send("first");
    await chat.send("second");

    const state = chat.getSnapshot();
    expect(state.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(callsOf(state.messages[0]?.activity)).toHaveLength(1);
    expect(callsOf(state.messages[2]?.activity)).toHaveLength(1);
    expect(state.trace).toEqual([]);
  });

  it("keeps the activity of a failed turn on its user message", async () => {
    const chat = sessionWith(async () => ({
      ok: false,
      failure: { kind: "network", message: "offline" },
    }));
    await chat.send("add");

    const state = chat.getSnapshot();
    expect(state.error?.kind).toBe("network");
    expect(state.trace).toEqual([]);
    expect(callsOf(state.messages[0]?.activity).map((call) => call.outcome)).toEqual(["failed"]);
  });

  it("keeps the activity of a cancelled turn on its user message", async () => {
    const chat = sessionWith(async () => {
      chat.cancel();
      throw new Error("aborted");
    });
    await chat.send("add");

    const state = chat.getSnapshot();
    expect(state.error?.kind).toBe("aborted");
    expect(state.trace).toEqual([]);
    expect(callsOf(state.messages[0]?.activity).map((call) => call.outcome)).toEqual(["failed"]);
  });

  it("keeps a repaired turn's rejected calls with its answer", async () => {
    let calls = 0;
    const chat = sessionWith(async () => {
      calls += 1;
      return { ok: true, text: calls === 1 ? "sorry, no JSON" : answer() };
    });
    await chat.send("add");

    const state = chat.getSnapshot();
    expect(state.error).toBeNull();
    expect(callsOf(state.messages[0]?.activity).map((call) => call.outcome)).toEqual([
      "rejected",
      "answer",
    ]);
  });

  it("orders the live turn's activity before the streaming bubble", async () => {
    const seen: string[][] = [];
    const chat = sessionWith(async (input) => {
      input.onText?.('{"message":"Hel');
      seen.push(transcriptEntries(chat.getSnapshot()).map(transcriptEntryKey));
      input.onText?.('lo there"}');
      return { ok: true, text: answer() };
    });
    await chat.send("hi");

    expect(seen[0]).toEqual(["message:user-1", "activity:user-1:live", "message:assistant-2"]);
    // The same rows settle into the persisted order once the turn ends.
    expect(transcriptEntries(chat.getSnapshot()).map(transcriptEntryKey)).toEqual([
      "message:user-1",
      "activity:user-1",
      "message:assistant-2",
    ]);
  });

  it("drops an exploration turn's partial prose so the answer is the last bubble", async () => {
    let calls = 0;
    const chat = sessionWith(async (input) => {
      calls += 1;
      if (calls === 1) {
        input.onText?.('{"message":"Let me look');
        return {
          ok: true,
          text: JSON.stringify({
            message: "Let me look.",
            script: "return 1",
            notes: [],
            requires_confirmation: false,
          }),
        };
      }
      return { ok: true, text: answer() };
    });
    await chat.send("add");

    const state = chat.getSnapshot();
    expect(state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(state.messages.at(-1)?.content).toBe("Here is the change.");
    expect(JSON.stringify(state.messages)).not.toContain("Let me look");
  });
});
