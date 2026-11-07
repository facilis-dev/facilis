// The SPEC §9.4/§9.5 turn loop: ask the model, let it explore with PTC programs, validate
// the final answer, and ask it to correct a rejected one.
//
// Kept out of ChatSession (which owns the visible conversation) so the control flow is
// unit-testable and the session stays under the 300-line limit. The loop never writes to
// the project: it returns either a parsed answer or the failure the chat shows.
//
// D-108: the loop has no counters. It ends when the merged set passes the validator, a
// provider call fails, the user cancels, or a validator outage makes a correction useless.
// The only way an answer reaches the project is a passing validation plus the user's Apply.
//
// D-106: when an answer is cut at the provider's output limit (or the model sends a large
// set in parts with "continue": true), the loop keeps the complete patches it received and
// asks for the rest; the merged set is what the validator sees.

import type { CallModelInput, CallModelResult } from "./client";
import type { PatchValidationHost } from "./patch-validation";
import {
  addPatches,
  beginCorrection,
  changedPatches,
  completeResponse,
  emptyPatchSet,
  formatContinuation,
  formatReceived,
  type PatchSetState,
} from "./patch-set";
import {
  formatScriptResult,
  type PtcRunner,
  type PtcRunResult,
  type PtcTraceEntry,
} from "./ptc/protocol";
import { buildRepairMessages, formatFailure } from "./repair";
import {
  parseAiResponse,
  validateResponse,
  type AiParseFailure,
  type AiParseResult,
} from "./response";
import { salvagePatches } from "./salvage";
import { capReasoning } from "./chat-trace";
import type { AiChatTurn, AiSettings, ChatFailure, ChatTraceCall } from "./types";

export interface TurnInput {
  call: (input: CallModelInput) => Promise<CallModelResult>;
  settings: AiSettings;
  system: string;
  /** The replayed conversation, ending with the new user turn. */
  messages: readonly AiChatTurn[];
  host: PatchValidationHost;
  signal: AbortSignal;
  onText: (chunk: string) => void;
  /** Called before each correction request with the 1-based attempt number. */
  onRepair: (attempt: number) => void;
  /** The PTC tool runtime; the chat has no other mode (D-103). */
  runner: PtcRunner;
  /** Called just before an exploration program starts (1-based program number). */
  onScriptStart?: (program: string, programNumber: number) => void;
  /** Called after each exploration program with its outcome. */
  onScript?: (result: PtcRunResult, program: string) => void;
  /** Called when another part of the same patch set is requested (1-based part). */
  onPatches?: (part: number) => void;
  /** Streams the provider's visible reasoning for the current call (D-110). */
  onReasoning?: (chunk: string) => void;
  /** A model call starts: the chat clears the live reasoning. */
  onCallStart?: (call: number) => void;
  /** A model call finished: what it cost and what the loop does with the answer (D-110). */
  onCall?: (call: ChatTraceCall) => void;
}

export type TurnOutcome =
  | { ok: true; parsed: Extract<AiParseResult, { ok: true }>; trace: PtcTraceEntry[] }
  | { ok: false; failure: ChatFailure };

/** Keep the provider's alternating-role requirement even when a turn is merged. */
function appendTurn(turns: AiChatTurn[], turn: AiChatTurn): void {
  const last = turns.at(-1);
  if (last !== undefined && last.role === turn.role) {
    last.content = last.content + "\n\n" + turn.content;
    return;
  }
  turns.push(turn);
}

/**
 * A validator outage (parser/analyzer) cannot be fixed by the model: no repair round. One
 * infrastructure finding is enough: the other findings cannot be trusted while the project was
 * not fully analyzed, and a correction would retry against the same broken worker (D-105/D-108).
 */
function isInternalFailure(failure: AiParseFailure): boolean {
  return failure.findings.some(
    (finding) => finding.infrastructure === true || finding.rule === "project-analysis",
  );
}

function validatorFailure(failure: AiParseFailure): TurnOutcome {
  return { ok: false, failure: { kind: "validator", message: formatFailure(failure) } };
}

/**
 * Ask the model to fix a rejected answer. Returns a failure when the rejection is internal;
 * otherwise appends the repair turns and returns null. There is no attempt cap (D-108).
 */
async function requestRepair(
  input: TurnInput,
  failure: AiParseFailure,
  attempt: number,
  turns: AiChatTurn[],
): Promise<TurnOutcome | null> {
  if (isInternalFailure(failure)) return validatorFailure(failure);
  input.onRepair(attempt);
  const messages = await buildRepairMessages({ failure, attempt });
  for (const turn of messages) appendTurn(turns, turn);
  return null;
}

export async function runTurn(input: TurnInput): Promise<TurnOutcome> {
  const turns: AiChatTurn[] = [...input.messages];
  const trace: PtcTraceEntry[] = [];
  let patchSet: PatchSetState = emptyPatchSet();
  let repairs = 0;
  let scripts = 0;
  let calls = 0;
  let firstCall = true;

  // No budget: the loop ends when the answer validates. See D-108 for why the counters that
  // used to stop it are gone, and for the terminators that remain.
  for (;;) {
    if (input.signal.aborted) {
      return { ok: false, failure: { kind: "aborted", message: "Cancelled by the user." } };
    }
    const streaming = firstCall;
    firstCall = false;
    calls += 1;
    const callNumber = calls;
    input.onCallStart?.(callNumber);
    const startedAt = Date.now();
    let result: CallModelResult;
    try {
      result = await input.call({
        settings: input.settings,
        system: input.system,
        messages: turns,
        signal: input.signal,
        // Only the first answer streams: a rejected attempt's bubble is dropped anyway, and
        // the repair/exploration status line already tells the user what is happening.
        ...(streaming ? { onText: input.onText } : {}),
        ...(input.onReasoning === undefined ? {} : { onReasoning: input.onReasoning }),
      });
    } catch (error) {
      // A host that throws (not just returns a failure) must not leave a "running" row behind.
      input.onCall?.({
        kind: "call",
        n: callNumber,
        elapsedMs: Date.now() - startedAt,
        chars: 0,
        reasoningChars: 0,
        outcome: "failed",
        truncated: false,
      });
      throw error;
    }
    // D-110: every call leaves one activity row: how long it took, how much it wrote, and
    // what the loop did with the answer. The chat shows it next to the programs.
    const finishCall = (outcome: ChatTraceCall["outcome"]): void => {
      input.onCall?.({
        kind: "call",
        n: callNumber,
        elapsedMs: Date.now() - startedAt,
        chars: result.ok ? result.text.length : 0,
        reasoningChars: result.ok ? (result.reasoning?.length ?? 0) : 0,
        outcome,
        truncated: result.ok && result.truncated === true,
        ...(result.ok && result.reasoning !== undefined && result.reasoning.length > 0
          ? { reasoning: capReasoning(result.reasoning) }
          : {}),
      });
    };
    if (!result.ok) {
      finishCall("failed");
      return { ok: false, failure: result.failure };
    }

    const parsed = parseAiResponse(result.text, { truncated: result.truncated === true });
    if (!parsed.ok) {
      // A cut-off answer still carries complete patches: keep them and ask for the rest
      // instead of asking for everything again (the same limit would cut it again).
      const salvaged = parsed.kind === "json" ? salvagePatches(result.text) : [];
      if (salvaged.length > 0) {
        const changed = changedPatches(patchSet, salvaged);
        patchSet = addPatches(patchSet, {
          message: "",
          patches: salvaged,
          notes: [],
          requiresConfirmation: false,
        });
        finishCall("cut");
        input.onPatches?.(patchSet.parts);
        appendTurn(turns, { role: "assistant", content: formatReceived(patchSet) });
        appendTurn(turns, {
          role: "user",
          content: formatContinuation({
            set: patchSet,
            cutOff: true,
            cutAt: result.text.length,
            changed,
          }),
        });
        continue;
      }
      finishCall("rejected");
      const stop = await requestRepair(input, parsed, repairs + 1, turns);
      if (stop !== null) return stop;
      repairs += 1;
      continue;
    }

    if (parsed.response.script !== undefined) {
      const program = parsed.response.script;
      finishCall("script");
      const turnNumber = scripts + 1;
      input.onScriptStart?.(program, turnNumber);
      const run = await input.runner.run(program, { signal: input.signal });
      if (input.signal.aborted) {
        return { ok: false, failure: { kind: "aborted", message: "Cancelled by the user." } };
      }
      scripts = turnNumber;
      trace.push(...run.trace);
      input.onScript?.(run, program);
      appendTurn(turns, { role: "assistant", content: result.text });
      appendTurn(turns, { role: "user", content: formatScriptResult(run) });
      continue;
    }

    const changed = changedPatches(patchSet, parsed.response.patches);
    patchSet = addPatches(patchSet, parsed.response);
    if (parsed.response.continue === true) {
      finishCall("part");
      input.onPatches?.(patchSet.parts);
      appendTurn(turns, { role: "assistant", content: formatReceived(patchSet) });
      appendTurn(turns, { role: "user", content: formatContinuation({ set: patchSet, changed }) });
      continue;
    }

    const checked = await validateResponse(completeResponse(patchSet), input.host, {
      signal: input.signal,
      raw: result.text,
    });
    if (!checked.ok) {
      // The rejected set is kept: a correction may re-emit only the files it changes, and
      // the untouched files stay part of the answer (D-106).
      patchSet = beginCorrection(patchSet);
      finishCall("rejected");
      const stop = await requestRepair(input, checked, repairs + 1, turns);
      if (stop !== null) return stop;
      repairs += 1;
      continue;
    }
    finishCall("answer");
    return {
      ok: true,
      parsed: { ok: true, response: completeResponse(patchSet), validation: checked.validation },
      trace,
    };
  }
}
