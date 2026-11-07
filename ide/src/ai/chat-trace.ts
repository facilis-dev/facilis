// Transcript rows for the chat activity timeline (D-101, D-110, docs/PTC.md §10).
//
// Pure state helpers: ChatSession stays under the line limit and the trace is unit-tested
// without React. The UI renders ChatActivity rows; nothing here touches the sandbox.

import type { PtcRunResult } from "./ptc/protocol";
import type { ChatActivity, ChatTraceCall, ChatTraceRun } from "./types";

/** How much reasoning the transcript keeps per call; the live stream is capped separately. */
export const CALL_REASONING_CHARS = 4_000;
/** How much reasoning the live panel keeps: a long chain only matters up to the latest step. */
export const LIVE_REASONING_CHARS = 12_000;

/** The in-progress row shown while the program runs (entries arrive when it finishes). */
export function beginTraceRun(trace: readonly ChatActivity[], program: string): ChatActivity[] {
  return [...trace, { kind: "run", program, ok: false, toolCalls: 0, elapsedMs: 0, entries: [] }];
}

/** Replace the in-progress run row with the finished run; the program is echoed for the UI. */
export function completeTraceRun(
  trace: readonly ChatActivity[],
  result: PtcRunResult,
  program: string,
  images: readonly string[] = [],
): ChatActivity[] {
  const run: ChatTraceRun = {
    kind: "run",
    program,
    ok: result.ok,
    ...(result.error === undefined ? {} : { error: result.error }),
    toolCalls: result.toolCalls,
    elapsedMs: result.elapsedMs,
    entries: [...result.trace],
    ...(images.length === 0 ? {} : { images: [...images] }),
  };
  if (trace.length === 0) return [run];
  return [...trace.slice(0, -1), run];
}

/**
 * Insert the call row when the provider call starts, so the live reasoning has its place in
 * the timeline (D-110): the row stays where it was and is completed in place.
 */
export function beginTraceCall(trace: readonly ChatActivity[], n: number): ChatActivity[] {
  return [
    ...trace,
    {
      kind: "call",
      n,
      elapsedMs: 0,
      chars: 0,
      reasoningChars: 0,
      outcome: "running",
      truncated: false,
    },
  ];
}

/** Complete the running row in place; a missing start row (a tolerant host) appends it. */
export function completeTraceCall(
  trace: readonly ChatActivity[],
  call: ChatTraceCall,
): ChatActivity[] {
  const last = trace.at(-1);
  if (last !== undefined && last.kind === "call" && last.n === call.n) {
    return [...trace.slice(0, -1), call];
  }
  return [...trace, call];
}

/** Keep the tail of the streamed reasoning: the latest thought is the interesting one. */
export function appendReasoning(
  current: string | null,
  chunk: string,
  cap: number = LIVE_REASONING_CHARS,
): string {
  const next = (current ?? "") + chunk;
  if (next.length <= cap) return next;
  return "…" + next.slice(next.length - cap + 1);
}

/** Cap the reasoning stored on one call row (the transcript is replayed to no one). */
export function capReasoning(text: string, cap: number = CALL_REASONING_CHARS): string {
  return text.length <= cap ? text : "…" + text.slice(text.length - cap + 1);
}
