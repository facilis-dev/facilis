// The transcript order (owner report 2026-11-10): strict chronological order in every state.
// Node-only vitest (ide/ has no jsdom), so this exercises the pure helper, not React.

import { describe, expect, it } from "vitest";
import { transcriptEntries, transcriptEntryKey } from "./transcript-entries";
import type { ChatActivity, ChatMessage, ChatState, ChatTraceCall } from "./types";

function call(n: number, outcome: ChatTraceCall["outcome"] = "answer"): ChatTraceCall {
  return {
    kind: "call",
    n,
    elapsedMs: 10,
    chars: 100,
    reasoningChars: 0,
    outcome,
    truncated: false,
  };
}

function message(
  id: string,
  role: ChatMessage["role"],
  content: string,
  activity?: readonly ChatActivity[],
): ChatMessage {
  return { id, role, content, at: 1, ...(activity === undefined ? {} : { activity }) };
}

function state(overrides: Partial<ChatState> = {}): ChatState {
  return {
    phase: "idle",
    messages: [],
    summary: null,
    proposal: null,
    applied: null,
    undo: null,
    streaming: false,
    repair: null,
    trace: [],
    reasoning: null,
    exploring: null,
    patchParts: null,
    error: null,
    settings: null,
    configured: true,
    context: null,
    ...overrides,
  };
}

/** [kind:turn] per entry, so an expectation reads as the transcript it describes. */
function shape(entries: ReturnType<typeof transcriptEntries>): string[] {
  return entries.map((entry) =>
    entry.kind === "message"
      ? "message:" + entry.message.id
      : entry.kind === "activity"
        ? "activity:" + entry.turn + (entry.live ? ":live" : "")
        : "summary",
  );
}

describe("transcriptEntries", () => {
  it("renders a finished turn as message -> activity -> answer", () => {
    const entries = transcriptEntries(
      state({
        messages: [
          message("u1", "user", "add", [call(1)]),
          message("a1", "assistant", "Here is the change."),
        ],
      }),
    );

    expect(shape(entries)).toEqual(["message:u1", "activity:u1", "message:a1"]);
    expect(entries[1]).toMatchObject({ kind: "activity", live: false });
  });

  it("keeps every turn in order after several turns", () => {
    const entries = transcriptEntries(
      state({
        messages: [
          message("u1", "user", "first", [call(1)]),
          message("a1", "assistant", "first answer"),
          message("u2", "user", "second", [call(2)]),
          message("a2", "assistant", "second answer"),
        ],
      }),
    );

    expect(shape(entries)).toEqual([
      "message:u1",
      "activity:u1",
      "message:a1",
      "message:u2",
      "activity:u2",
      "message:a2",
    ]);
    expect(new Set(entries.map(transcriptEntryKey)).size).toBe(entries.length);
  });

  it("puts the live activity before the streaming answer bubble", () => {
    const entries = transcriptEntries(
      state({
        phase: "sending",
        streaming: true,
        reasoning: "thinking",
        messages: [message("u1", "user", "add"), message("a1", "assistant", "Hel")],
        trace: [call(1, "running")],
      }),
    );

    expect(shape(entries)).toEqual(["message:u1", "activity:u1:live", "message:a1"]);
    expect(entries[1]).toMatchObject({ kind: "activity", live: true });
    expect(entries[2]).toMatchObject({ kind: "message", streaming: true });
  });

  it("keeps a failed turn's activity after its user message", () => {
    const entries = transcriptEntries(
      state({
        error: { kind: "network", message: "offline" },
        messages: [message("u1", "user", "add", [call(1, "failed")])],
      }),
    );

    expect(shape(entries)).toEqual(["message:u1", "activity:u1"]);
    expect(entries[1]).toMatchObject({ kind: "activity", live: false });
  });

  it("puts the compaction marker after the activity of the last covered message", () => {
    const summary = { content: "so far", at: 2, through: 2 };
    const entries = transcriptEntries(
      state({
        summary,
        messages: [
          message("u1", "user", "first", [call(1)]),
          message("a1", "assistant", "first answer"),
          message("u2", "user", "second", [call(2)]),
          message("a2", "assistant", "second answer"),
        ],
      }),
    );

    expect(shape(entries)).toEqual([
      "message:u1",
      "activity:u1",
      "message:a1",
      "summary",
      "message:u2",
      "activity:u2",
      "message:a2",
    ]);
  });

  it("keeps past activity while the current turn streams", () => {
    const entries = transcriptEntries(
      state({
        phase: "sending",
        streaming: true,
        messages: [
          message("u1", "user", "first", [call(1)]),
          message("a1", "assistant", "first answer"),
          message("u2", "user", "second"),
          message("a2", "assistant", "Hel"),
        ],
        trace: [call(2, "running")],
      }),
    );

    expect(shape(entries)).toEqual([
      "message:u1",
      "activity:u1",
      "message:a1",
      "message:u2",
      "activity:u2:live",
      "message:a2",
    ]);
  });
});
