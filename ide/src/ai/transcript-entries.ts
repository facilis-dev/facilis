// Strict chronological transcript order (owner report 2026-11-10): the assistant's answer
// must render after the model calls and programs that produced it, in every state.
//
// Pure and React-free on purpose: the IDE's vitest environment is node (no jsdom), so the
// ordering is unit-tested by feeding a ChatState to transcriptEntries(); ChatTranscriptView is
// the only renderer and maps these entries 1:1.

import type { ChatActivity, ChatMessage, ChatState, ChatSummary } from "./types";

/** One row of the chat transcript, in time order. */
export type TranscriptEntry =
  | { kind: "summary"; summary: ChatSummary }
  | { kind: "message"; message: ChatMessage; streaming: boolean }
  | {
      kind: "activity";
      /** The user message that opened the turn; also the React key of the group. */
      turn: string;
      activity: readonly ChatActivity[];
      /** The turn still runs: its rows carry the live reasoning and the running program. */
      live: boolean;
    };

/** The message that opened the live turn: the last user message in the transcript. */
function lastUserIndex(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return index;
  }
  return -1;
}

/**
 * Messages in order, each followed by the activity that followed it; the live turn's rows
 * after the user message that opened it (ChatSession always appends that message before its
 * first activity row); and the compaction marker after the last message the summary covers.
 *
 * The live activity goes BEFORE a trailing streaming answer bubble: the bubble is already in
 * `messages`, but it belongs after the calls that produced it.
 */
export function transcriptEntries(state: ChatState): TranscriptEntry[] {
  const { messages, summary, trace, streaming } = state;
  // `trace` is the live turn only (a finished turn's rows move onto its user message), so a
  // non-empty trace means the last turn is still running.
  const liveAnchor = trace.length > 0 ? lastUserIndex(messages) : -1;
  const entries: TranscriptEntry[] = [];
  messages.forEach((message, index) => {
    entries.push({
      kind: "message",
      message,
      streaming: streaming && index === messages.length - 1,
    });
    if (message.activity !== undefined && message.activity.length > 0) {
      entries.push({ kind: "activity", turn: message.id, activity: message.activity, live: false });
    }
    if (index === liveAnchor) {
      entries.push({ kind: "activity", turn: message.id, activity: trace, live: true });
    }
    if (summary !== null && index === summary.through - 1) {
      entries.push({ kind: "summary", summary });
    }
  });
  return entries;
}

/** A stable React key per entry; the kinds are distinct so a message and its rows never clash. */
export function transcriptEntryKey(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case "message":
      return "message:" + entry.message.id;
    case "activity":
      return "activity:" + entry.turn + (entry.live ? ":live" : "");
    case "summary":
      return "summary:" + String(entry.summary.at);
  }
}
