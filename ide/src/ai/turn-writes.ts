// The write tools' turn-loop step (D-181/D-193): after a program wrote (or tried to write)
// source, the loop settles three things the tools cannot decide themselves:
//
// - the clean-tree gate: a refused write pauses the turn until the user commits (and the
//   turn continues with a "clean now" notice) or stops it;
// - a destructive schema write: the turn pauses for the user's confirmation, and only an
//   approved one is applied (the write itself was held back, nothing landed);
// - a declared non-standard capability (D-226): the same pause, but a decline drops the write
//   and the turn CONTINUES, because the model can retry with a standard handler;
// - a validator outage: an infrastructure finding ends the turn instead of spending model
//   calls on a broken analyzer (D-105); nothing was written.
//
// Kept out of turn.ts, which is at the 300-line limit and owns the model/answer protocol.

import type { SurfaceRequest } from "@facilis.dev/ai";

import { appendTurn } from "./chat-session-types";
import type { ChatWrites } from "./chat-writes";
import type { AiChatTurn, ChatFailure, ChatGitGateFailure } from "./types";

/** The user's answer to the declaration card: confirm with (maybe edited) reasons, or decline. */
export type SurfaceDecision =
  { kind: "confirm"; reasons: Readonly<Record<string, string>> } | { kind: "cancel" };

export interface GitGateStepInput {
  writes?: ChatWrites;
  pauseGitGate?: (failure: ChatGitGateFailure) => Promise<"continue" | "stop">;
  pauseSchemaConfirm?: (changes: readonly string[]) => Promise<"apply" | "cancel">;
  /** A write declares a non-standard capability: pause for the user's confirmation (D-226). */
  pauseSurfaceConfirm?: (requests: readonly SurfaceRequest[]) => Promise<SurfaceDecision>;
  signal: AbortSignal;
}

/** "Clean now, re-issue the write" as the next user turn (merges with the program result). */
const CLEAN_NOTICE =
  "The working tree is clean now: the user committed. Re-issue the write you were making, then continue.";

/** The confirmed schema write is already applied: the turn continues from there. */
const SCHEMA_CONFIRMED_NOTICE =
  "The user confirmed the destructive schema change and it is applied. Continue with the rest of the work.";

/** The confirmed declaration is applied (maybe with a reworded reason). */
const SURFACE_CONFIRMED_NOTICE =
  "The user confirmed the declared capability and the write is applied. Do not repeat the declaration; continue with the rest of the work.";

/** The user declined: nothing was written, and the model must find a standard way. */
const SURFACE_DECLINED_NOTICE =
  "The user declined the declared capability, so nothing was written. Do not retry the same declaration and do not hide or bypass it: use the standard API instead, or explain what the user must approve.";

function aborted(message: string): { ok: false; failure: ChatFailure } {
  return { ok: false, failure: { kind: "aborted", message } };
}

/** Settle the gate/confirmation/outage after a program; null when the loop may continue. */
export async function settleWriteStep(
  input: GitGateStepInput,
  turns: AiChatTurn[],
): Promise<{ ok: true } | { ok: false; failure: ChatFailure }> {
  const gate = input.writes?.takeGateFailure() ?? null;
  if (gate !== null) {
    const decision = input.pauseGitGate === undefined ? "stop" : await input.pauseGitGate(gate);
    if (input.signal.aborted) return aborted("Cancelled by the user.");
    if (decision === "stop") return aborted("Paused: the working tree is not clean.");
    appendTurn(turns, { role: "user", content: CLEAN_NOTICE });
  }
  const confirmation = input.writes?.takeSchemaConfirmation() ?? null;
  if (confirmation !== null) {
    const decision =
      input.pauseSchemaConfirm === undefined
        ? "cancel"
        : await input.pauseSchemaConfirm(confirmation.changes);
    if (input.signal.aborted) return aborted("Cancelled by the user.");
    if (decision === "cancel") {
      return aborted("Paused: the user declined the destructive schema change.");
    }
    const applied = await input.writes?.applyPending();
    if (input.signal.aborted) return aborted("Cancelled by the user.");
    if (applied === undefined || !applied.ok) {
      return aborted("The destructive schema change could not be applied; nothing was written.");
    }
    appendTurn(turns, { role: "user", content: SCHEMA_CONFIRMED_NOTICE });
  }
  const surface = input.writes?.takeSurfaceConfirmation() ?? null;
  if (surface !== null) {
    const decision =
      input.pauseSurfaceConfirm === undefined
        ? { kind: "cancel" as const }
        : await input.pauseSurfaceConfirm(surface.requests);
    if (input.signal.aborted) return aborted("Cancelled by the user.");
    if (decision.kind === "cancel") {
      // Nothing was written: dropping the pending patch is enough, and the turn goes on.
      input.writes?.discardPendingSurface();
      appendTurn(turns, { role: "user", content: SURFACE_DECLINED_NOTICE });
    } else {
      const applied = await input.writes?.applyPendingSurface(decision.reasons);
      if (input.signal.aborted) return aborted("Cancelled by the user.");
      if (applied === undefined || !applied.ok) {
        return aborted("The declared capability could not be written; nothing was written.");
      }
      appendTurn(turns, { role: "user", content: SURFACE_CONFIRMED_NOTICE });
    }
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
