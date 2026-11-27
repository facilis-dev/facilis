// The SPEC §9.4/§9.5 turn loop: ask the model, let it explore with PTC programs, and accept
// its final answer. Source changes happen inside a program through the validated write tools
// (D-181); the answer itself is the turn's summary, never a patch set (D-192).
//
// Kept out of ChatSession (which owns the visible conversation) so the control flow is
// unit-testable and the session stays under the 300-line limit. The loop never writes to
// the project: it returns either a parsed answer or the failure the chat shows.
//
// D-108: the loop has no counters. It ends when the answer parses, a provider call fails, or
// the user cancels; a refused clean-tree gate or a validator outage ends it through the
// write step instead.

import type { SurfaceRequest } from "@facilis.dev/ai";

import type { CallModelInput, CallModelResult } from "./client";
import type { PatchValidationHost } from "./patch-validation";
import {
  formatScriptResult,
  type PtcRunner,
  type PtcRunResult,
  type PtcTraceEntry,
} from "./ptc/protocol";
import { buildRepairMessages } from "./repair";
import { parseAiResponse, type AiParseFailure, type AiParseResult } from "./response";
import { capReasoning } from "./chat-trace";
import { appendTurn } from "./chat-session-types";
import type { ChatWrites } from "./chat-writes";
import { settleWriteStep, type SurfaceDecision } from "./turn-writes";
import type {
  AiChatTurn,
  AiSettings,
  ChatFailure,
  ChatGitGateFailure,
  ChatTraceCall,
} from "./types";

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
  /** Called after each exploration program with its outcome and captured screenshots. */
  onScript?: (result: PtcRunResult, program: string, images: readonly string[]) => void;
  /** The incremental write engine the write tools use (D-181). */
  writes?: ChatWrites;
  /** A write hit the clean-tree gate: pause the turn until the user commits or stops. */
  pauseGitGate?: (failure: ChatGitGateFailure) => Promise<"continue" | "stop">;
  /** A write drops a table or a column: pause the turn for the user's confirmation (D-193). */
  pauseSchemaConfirm?: (changes: readonly string[]) => Promise<"apply" | "cancel">;
  /** A write declares a non-standard capability: pause for the user's confirmation (D-226). */
  pauseSurfaceConfirm?: (requests: readonly SurfaceRequest[]) => Promise<SurfaceDecision>;
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

/**
 * Ask the model to fix an answer that is not a valid AIResponse. Returns a failure only when
 * the user cancelled; otherwise appends the repair turns and returns null. No attempt cap
 * (D-108).
 */
async function requestRepair(
  input: TurnInput,
  failure: AiParseFailure,
  attempt: number,
  turns: AiChatTurn[],
): Promise<TurnOutcome | null> {
  input.onRepair(attempt);
  const messages = await buildRepairMessages({ failure, attempt });
  for (const turn of messages) appendTurn(turns, turn);
  return null;
}

export async function runTurn(input: TurnInput): Promise<TurnOutcome> {
  const turns: AiChatTurn[] = [...input.messages];
  const trace: PtcTraceEntry[] = [];
  let repairs = 0;
  let scripts = 0;
  let calls = 0;
  let firstCall = true;

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
      // D-112/D-171/D-175: preview and project-graph screenshots, plus images the web tools
      // fetched, travel with the program's result turn (the activity row shows them to the
      // user; a vision preset also sends them to the model).
      const images = [
        ...(input.host.preview?.takeImages() ?? []),
        ...(input.host.graphView?.takeImages() ?? []),
        ...(input.host.web?.takeImages() ?? []),
      ];
      input.onScript?.(run, program, images);
      appendTurn(turns, { role: "assistant", content: result.text });
      appendTurn(turns, {
        role: "user",
        content: formatScriptResult(run),
        ...(images.length > 0 ? { images } : {}),
      });
      const settled = await settleWriteStep(input, turns);
      if (!settled.ok) return settled;
      continue;
    }

    finishCall("answer");
    return { ok: true, parsed, trace };
  }
}
