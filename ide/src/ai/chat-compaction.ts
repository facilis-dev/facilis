// Context compaction (O-018, CHAT-UX "Compact"): one model call turns the conversation so
// far into a replayable summary, so a long session replays the summary plus the messages
// after it instead of losing the earlier context to HISTORY_LIMIT.
//
// Split out of chat-session.ts (at the 300-line limit): the session owns phase, cancel and
// state; this module owns the summarization prompt, the summary shape and replay preparation.

import { errorText, replayTurns } from "./chat-session-types";
import type { CallModelInput, CallModelResult } from "./client";
import type { AiChatTurn, AiSettings, ChatFailure, ChatMessage, ChatSummary } from "./types";

/** The fixed system prompt: the answer becomes context for the next turn, not a chat bubble. */
export const COMPACTION_SYSTEM = [
  "You compress a conversation between a developer and an IDE coding assistant.",
  "Write one continuation summary: the developer's goals, decisions made, files and changes",
  "touched, the current state and any open threads. Keep paths, identifiers and commands",
  "exactly as written. Reply with the summary text only, without a preamble or code fence.",
].join(" ");

/** The summary replays as the first user turn; the wording tells the model it is context. */
const SUMMARY_PREFIX = "Earlier in this conversation (compacted summary, keep as context):\n\n";

export interface CompactionCall {
  call: (input: CallModelInput) => Promise<CallModelResult>;
  now: () => number;
  settings: AiSettings;
  /** Every message in the transcript; `through` counts them. */
  messages: readonly ChatMessage[];
  /** The previous summary, when this is a second compaction. */
  summary: ChatSummary | null;
  signal: AbortSignal;
}

export type CompactionOutcome = { summary: ChatSummary } | { failure: ChatFailure };

/** One summarization call. Never throws; the caller owns phase and cancellation. */
export async function compactConversation(input: CompactionCall): Promise<CompactionOutcome> {
  let result: CallModelResult;
  try {
    result = await input.call({
      settings: input.settings,
      system: COMPACTION_SYSTEM,
      // All messages: limit = the transcript length keeps every one of them.
      messages: replayWithSummary(input.messages, input.summary, input.messages.length),
      signal: input.signal,
    });
  } catch (error) {
    return { failure: { kind: "stream", message: errorText(error) } };
  }
  if (!result.ok) return { failure: result.failure };
  const content = result.text.trim();
  if (content.length === 0) {
    return { failure: { kind: "empty", message: "The provider returned an empty summary." } };
  }
  return { summary: { content, at: input.now(), through: input.messages.length } };
}

/**
 * The turns replayed on the next send: the summary as context, then only the messages after
 * `through` (still capped by the caller's HISTORY_LIMIT). Without a summary this is the old
 * replay unchanged.
 */
export function replayWithSummary(
  messages: readonly ChatMessage[],
  summary: ChatSummary | null,
  limit: number,
): AiChatTurn[] {
  if (summary === null) return replayTurns(messages, limit);
  const turns = replayTurns(messages.slice(summary.through), limit);
  const first = turns[0];
  // Anthropic rejects two user turns in a row: fold the summary into a user turn that starts
  // the replay, or prepend it when the replay starts with the assistant (or is empty).
  if (first !== undefined && first.role === "user") {
    const joiner = first.content.length > 0 ? "\n\n" : "";
    turns[0] = { ...first, content: SUMMARY_PREFIX + summary.content + joiner + first.content };
    return turns;
  }
  return [{ role: "user", content: SUMMARY_PREFIX + summary.content }, ...turns];
}
