// The SPEC §9.4/§9.5 turn loop: ask the model, let it explore with PTC programs, validate
// the final answer, and ask it to correct a rejected one.
//
// Kept out of ChatSession (which owns the visible conversation) so the control flow is
// unit-testable and the session stays under the 300-line limit. The loop never writes to
// the project: it returns either a parsed answer or the failure the chat shows.

import type { CallModelInput, CallModelResult } from "./client";
import type { PatchValidationHost } from "./patch-validation";
import {
  formatScriptResult,
  MAX_SCRIPT_TURNS,
  MAX_TOOL_CALLS_PER_TURN,
  type PtcRunner,
  type PtcRunResult,
  type PtcTraceEntry,
} from "./ptc/protocol";
import { buildRepairMessages, formatFailure, MAX_REPAIR_ATTEMPTS } from "./repair";
import {
  parseAiResponse,
  validateResponse,
  type AiParseFailure,
  type AiParseResult,
} from "./response";
import type { AiChatTurn, AiSettings, ChatFailure } from "./types";

/** Model calls per user message: the first answer, the corrections and the explorations. */
const MAX_MODEL_CALLS = MAX_SCRIPT_TURNS + MAX_REPAIR_ATTEMPTS + 1;

export interface TurnInput {
  call: (input: CallModelInput) => Promise<CallModelResult>;
  settings: AiSettings;
  system: string;
  /** The replayed conversation, ending with the new user turn. */
  messages: readonly AiChatTurn[];
  host: PatchValidationHost;
  signal: AbortSignal;
  onText: (chunk: string) => void;
  /** Called before each correction request with the 1-based attempt and the cap. */
  onRepair: (attempt: number, max: number) => void;
  /** The PTC tool runtime; the chat has no other mode (D-103). */
  runner: PtcRunner;
  /** Called just before an exploration program starts (1-based program number). */
  onScriptStart?: (program: string, turn: number) => void;
  /** Called after each exploration program with its outcome. */
  onScript?: (result: PtcRunResult, program: string) => void;
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

/** A validator outage (parser/analyzer) cannot be fixed by the model: no repair round. */
function isInternalFailure(failure: AiParseFailure): boolean {
  if (failure.findings.length === 0) return false;
  return failure.findings.every(
    (finding) => finding.infrastructure === true || finding.rule === "project-analysis",
  );
}

function validatorFailure(failure: AiParseFailure): TurnOutcome {
  return { ok: false, failure: { kind: "validator", message: formatFailure(failure) } };
}

function parsingFailure(failure: AiParseFailure): TurnOutcome {
  return { ok: false, failure: { kind: "parse", message: formatFailure(failure) } };
}

/**
 * Ask the model to fix a rejected answer. Returns a failure when the correction budget is
 * gone or the rejection is internal; otherwise appends the repair turns and returns null.
 */
async function requestRepair(
  input: TurnInput,
  failure: AiParseFailure,
  repairs: number,
  turns: AiChatTurn[],
): Promise<TurnOutcome | null> {
  if (isInternalFailure(failure)) return validatorFailure(failure);
  if (repairs >= MAX_REPAIR_ATTEMPTS) return parsingFailure(failure);
  const next = repairs + 1;
  input.onRepair(next, MAX_REPAIR_ATTEMPTS);
  const messages = await buildRepairMessages({
    failure,
    attempt: next,
    max: MAX_REPAIR_ATTEMPTS,
  });
  for (const turn of messages) appendTurn(turns, turn);
  return null;
}

export async function runTurn(input: TurnInput): Promise<TurnOutcome> {
  const turns: AiChatTurn[] = [...input.messages];
  const trace: PtcTraceEntry[] = [];
  let repairs = 0;
  let scripts = 0;
  let toolCalls = 0;
  let modelCalls = 0;

  for (;;) {
    if (input.signal.aborted) {
      return { ok: false, failure: { kind: "aborted", message: "Cancelled by the user." } };
    }
    if (modelCalls >= MAX_MODEL_CALLS) {
      return {
        ok: false,
        failure: {
          kind: "parse",
          message: "The assistant used its whole exploration and correction budget without a final answer.",
        },
      };
    }
    const first = modelCalls === 0;
    modelCalls += 1;
    const result = await input.call({
      settings: input.settings,
      system: input.system,
      messages: turns,
      signal: input.signal,
      // Only the first answer streams: a rejected attempt's bubble is dropped anyway, and
      // the repair/exploration status line already tells the user what is happening.
      ...(first ? { onText: input.onText } : {}),
    });
    if (!result.ok) return { ok: false, failure: result.failure };

    const parsed = parseAiResponse(result.text);
    if (!parsed.ok) {
      const stop = await requestRepair(input, parsed, repairs, turns);
      if (stop !== null) return stop;
      repairs += 1;
      continue;
    }

    if (parsed.response.script !== undefined) {
      if (scripts >= MAX_SCRIPT_TURNS) {
        return {
          ok: false,
          failure: {
            kind: "parse",
            message:
              "The assistant exceeded the exploration budget (" + MAX_SCRIPT_TURNS + " programs).",
          },
        };
      }
      const program = parsed.response.script;
      const turnNumber = scripts + 1;
      input.onScriptStart?.(program, turnNumber);
      const run = await input.runner.run(program, {
        signal: input.signal,
        toolCallBudget: MAX_TOOL_CALLS_PER_TURN - toolCalls,
      });
      if (input.signal.aborted) {
        return { ok: false, failure: { kind: "aborted", message: "Cancelled by the user." } };
      }
      scripts = turnNumber;
      toolCalls += run.toolCalls;
      trace.push(...run.trace);
      input.onScript?.(run, program);
      appendTurn(turns, { role: "assistant", content: result.text });
      appendTurn(turns, { role: "user", content: formatScriptResult(run) });
      continue;
    }

    const checked = await validateResponse(parsed.response, input.host, {
      signal: input.signal,
      raw: result.text,
    });
    if (!checked.ok) {
      const stop = await requestRepair(input, checked, repairs, turns);
      if (stop !== null) return stop;
      repairs += 1;
      continue;
    }
    return {
      ok: true,
      parsed: { ok: true, response: parsed.response, validation: checked.validation },
      trace,
    };
  }
}
