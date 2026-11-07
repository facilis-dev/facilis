// Run outcome helpers for the PTC runner (docs/PTC.md §4, D-101).
//
// Split out of runner.ts to stay under the 300-line limit: the lifecycle in runner.ts reads
// better when the "what a failed run looks like" plumbing lives on its own.

import {
  boundedJson,
  isLosslessJson,
  type PtcFailureKind,
  type PtcJson,
  type PtcRunResult,
  type PtcTraceEntry,
} from "./protocol";

/** The message shape isToolRequest guarantees (args are re-validated as JSON). */
export type ToolRequest = { type: "tool"; id: number; name: string; args: unknown };

/** Delimited so an exact kind match cannot be spoofed by a substring. */
const FAILURE_KINDS = "|exception|timeout|abort|output-limit|protocol|capability|";

export function isFailureKind(value: unknown): value is PtcFailureKind {
  return typeof value === "string" && FAILURE_KINDS.includes("|" + value + "|");
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return boundedJson(error);
}

/** Serialised length, or null when the value does not round-trip through JSON. */
export function jsonLength(value: unknown): number | null {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return null;
    // A second parse catches a stringify that silently dropped a non-JSON value.
    if (!isLosslessJson(value)) return null;
    return json.length;
  } catch {
    return null;
  }
}

/** Refused/failed runs end here; the child (if any) is terminated by run()'s finally. */
export function fail(
  startedAt: number,
  trace: PtcTraceEntry[],
  kind: PtcFailureKind,
  message: string,
): PtcRunResult {
  return resultOf(startedAt, trace, false, undefined, { kind, message });
}

export function resultOf(
  startedAt: number,
  trace: PtcTraceEntry[],
  ok: boolean,
  value: PtcJson | undefined,
  error: { kind: PtcFailureKind; message: string } | undefined,
): PtcRunResult {
  return {
    ok,
    ...(ok
      ? { value: value ?? null }
      : { error: error ?? { kind: "exception", message: "run failed" } }),
    toolCalls: trace.length,
    elapsedMs: Date.now() - startedAt,
    trace,
  };
}
