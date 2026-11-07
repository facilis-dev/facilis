// Transcript rows for the PTC exploration (D-101, docs/PTC.md §10).
//
// Pure state helpers: ChatSession stays under the line limit and the trace is unit-tested
// without React. The UI renders ChatTraceRun rows; nothing here touches the sandbox.

import type { PtcRunResult } from "./ptc/protocol";
import type { ChatTraceRun } from "./types";

/** The in-progress row shown while the program runs (entries arrive when it finishes). */
export function beginTraceRun(trace: readonly ChatTraceRun[], program: string): ChatTraceRun[] {
  return [...trace, { program, ok: false, toolCalls: 0, elapsedMs: 0, entries: [] }];
}

/** Replace the in-progress row with the finished run; the program is echoed for the UI. */
export function completeTraceRun(
  trace: readonly ChatTraceRun[],
  result: PtcRunResult,
  program: string,
): ChatTraceRun[] {
  const run: ChatTraceRun = {
    program,
    ok: result.ok,
    ...(result.error === undefined ? {} : { error: result.error }),
    toolCalls: result.toolCalls,
    elapsedMs: result.elapsedMs,
    entries: [...result.trace],
  };
  if (trace.length === 0) return [run];
  return [...trace.slice(0, -1), run];
}
