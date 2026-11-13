// The write tools' turn-loop step (D-181): after a program wrote (or tried to write)
// source, the loop settles two things the tools cannot decide themselves:
//
// - the clean-tree gate: a refused write pauses the turn until the user commits (and the
//   turn continues with a "clean now" notice) or stops it;
// - a validator outage: an infrastructure finding ends the turn instead of spending model
//   calls on a broken analyzer (D-105); nothing was written.
//
// Kept out of turn.ts, which is at the 300-line limit and owns the model/answer protocol.

import { appendTurn } from "./chat-session-types";
import type { ChatWrites } from "./chat-writes";
import type { AiChatTurn, ChatFailure, ChatGitGateFailure } from "./types";

export interface GitGateStepInput {
  writes?: ChatWrites;
  pauseGitGate?: (failure: ChatGitGateFailure) => Promise<"continue" | "stop">;
  signal: AbortSignal;
}

/** "Clean now, re-issue the write" as the next user turn (merges with the program result). */
const CLEAN_NOTICE =
  "The working tree is clean now: the user committed. Re-issue the write you were making, then continue.";

/** Settle the gate/outage after a program; null when the loop may continue normally. */
export async function settleWriteStep(
  input: GitGateStepInput,
  turns: AiChatTurn[],
): Promise<{ ok: true } | { ok: false; failure: ChatFailure }> {
  const gate = input.writes?.takeGateFailure() ?? null;
  if (gate !== null) {
    const decision = input.pauseGitGate === undefined ? "stop" : await input.pauseGitGate(gate);
    if (input.signal.aborted) {
      return { ok: false, failure: { kind: "aborted", message: "Cancelled by the user." } };
    }
    if (decision === "stop") {
      return {
        ok: false,
        failure: { kind: "aborted", message: "Paused: the working tree is not clean." },
      };
    }
    appendTurn(turns, { role: "user", content: CLEAN_NOTICE });
  }
  if (input.writes?.outage() === true) {
    return {
      ok: false,
      failure: {
        kind: "validator",
        message: "The project analyzer is unavailable: nothing was written.",
      },
    };
  }
  return { ok: true };
}
