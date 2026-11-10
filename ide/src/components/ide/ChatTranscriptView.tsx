// The chat transcript list, in strict chronological order (owner report 2026-11-10): a turn
// reads user message -> its model calls/programs -> its answer, and a finished turn keeps that
// activity in place because ChatSession snapshots it onto the user message (turnEnded).
//
// The order itself lives in the pure transcriptEntries() helper (ai/transcript-entries.ts), so
// it is unit-tested without React: ide/ has no jsdom. This file only maps entries to rows; all
// strings go through t() and every colour is a role (D-043/D-044).

import type { ChatState } from "@/ai/types";
import { transcriptEntries, transcriptEntryKey } from "@/ai/transcript-entries";
import type { TranscriptEntry } from "@/ai/transcript-entries";
import { ChatMessageView } from "./ChatMessageView";
import { ChatSummaryView } from "./ChatSummaryView";
import { ChatTraceView } from "./ChatTraceView";

function TranscriptRow({ entry, state }: { entry: TranscriptEntry; state: ChatState }) {
  switch (entry.kind) {
    case "message":
      return <ChatMessageView message={entry.message} streaming={entry.streaming} />;
    case "activity":
      return (
        <ChatTraceView
          trace={entry.activity}
          exploring={entry.live ? state.exploring : null}
          reasoning={entry.live ? state.reasoning : null}
          live={entry.live}
        />
      );
    case "summary":
      return <ChatSummaryView summary={entry.summary} />;
  }
}

export function ChatTranscriptView({ state }: { state: ChatState }) {
  return (
    <>
      {transcriptEntries(state).map((entry) => (
        <TranscriptRow key={transcriptEntryKey(entry)} entry={entry} state={state} />
      ))}
    </>
  );
}
