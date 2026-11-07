// Shared vocabulary for the PTC tool runtime (SPEC §9.5, docs/PTC.md, D-101).
//
// Pure types and helpers: no DOM, no React, no provider code. The runner (runner.ts) owns
// the program lifecycle, the router (tools.ts) owns what a program may read, and the turn
// loop (turn.ts) owns the alternating script/answer protocol. Keeping the wire vocabulary
// here lets Node tests exercise the whole chain without a browser.
//
// Wire protocol (host <-> sandboxed runner page):
//   host -> child  { type: "run", runId, program }
//                  { type: "tool-result", id, ok, value? | error? }
//                  { type: "stop", reason }
//   child -> host  { type: "tool", id, name, args }
//                  { type: "result", value }
//                  { type: "error", kind, message }

import type { ValidationError } from "@facilis/ai";

export type PtcJson =
  | null
  | boolean
  | number
  | string
  | PtcJson[]
  | { [key: string]: PtcJson };

/** One script turn or one answer: the two shapes are mutually exclusive (D-101). */
export const MAX_SCRIPT_TURNS = 6;
export const MAX_PROGRAM_CHARS = 16_000;
export const MAX_TOOL_CALLS_PER_RUN = 32;
export const MAX_TOOL_CALLS_PER_TURN = 64;
export const MAX_TOOL_RESULT_CHARS = 64_000;
export const RUN_TIMEOUT_MS = 5_000;
/** Arguments are echoed into the trace; cap them so one call cannot flood the UI/log. */
export const MAX_TRACE_ARGS_CHARS = 2_000;

/** The tool list the prompt advertises; the handler lives in tools.ts. */
export interface PtcToolSpec {
  name: string;
  /** Human signature shown to the model, e.g. "read_file({ path, startLine?, endLine? })". */
  signature: string;
  description: string;
}

export interface PtcToolCall {
  name: string;
  args: unknown;
}

/** What the runner executes a program against; implemented by tools.ts. */
export interface PtcToolExecutor {
  specs(): readonly PtcToolSpec[];
  execute(call: PtcToolCall, options: { signal?: AbortSignal }): Promise<PtcJson>;
}

export type PtcFailureKind =
  | "exception"
  | "timeout"
  | "abort"
  | "output-limit"
  | "protocol"
  | "capability";

/** One tool call as the trace (and later the UI) records it. */
export interface PtcTraceEntry {
  name: string;
  args: string;
  ok: boolean;
  durationMs: number;
  bytes: number;
  error?: string;
}

export interface PtcRunResult {
  ok: boolean;
  value?: PtcJson;
  error?: { kind: PtcFailureKind; message: string };
  toolCalls: number;
  elapsedMs: number;
  trace: PtcTraceEntry[];
}

export interface PtcRunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Tool calls still allowed in this user turn; the runner refuses calls past it. */
  toolCallBudget?: number;
}

/**
 * The sandbox transport. runner-frame.ts implements it with a sandboxed iframe; the Node
 * tests implement it with a scripted fake, so the RPC/caps/timeout logic is unit-tested.
 */
export interface PtcChild {
  post(message: unknown): void;
  onMessage(listener: (data: unknown) => void): () => void;
  terminate(reason: string): void;
}

export interface PtcChildFactory {
  create(): Promise<PtcChild>;
}

export interface PtcRunner {
  specs(): readonly PtcToolSpec[];
  run(program: string, options?: PtcRunOptions): Promise<PtcRunResult>;
  dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when JSON.stringify then parse round-trips the value (the sandbox boundary). */
export function isLosslessJson(value: unknown): boolean {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return false;
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

/** A bounded JSON rendering for traces and prompts; never throws. */
export function boundedJson(value: unknown, limit = MAX_TRACE_ARGS_CHARS): string {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserialisable]";
  }
  return json.length <= limit ? json : json.slice(0, limit) + "…";
}

/** The user-role turn that carries a program outcome back to the model. */
export function formatScriptResult(result: PtcRunResult): string {
  const lines: string[] = [];
  if (result.ok) {
    lines.push("The program finished. Its return value (JSON):");
    lines.push(boundedJson(result.value ?? null, MAX_TOOL_RESULT_CHARS));
  } else {
    const kind = result.error?.kind ?? "exception";
    lines.push("The program failed (" + kind + "): " + (result.error?.message ?? "unknown error"));
  }
  if (result.trace.length > 0) {
    lines.push("", "Tool calls this run:");
    for (const entry of result.trace.slice(0, 20)) {
      lines.push(
        "- " +
          entry.name +
          " " +
          (entry.ok ? "ok" : "failed") +
          " " +
          entry.durationMs +
          "ms" +
          (entry.error === undefined ? "" : " (" + entry.error + ")"),
      );
    }
    if (result.trace.length > 20) lines.push("- … " + (result.trace.length - 20) + " more");
  }
  lines.push("", "Budget used: " + result.toolCalls + " tool call(s).");
  return lines.join("\n");
}

/** The prompt section that teaches the model the tool signatures. */
export function describeTools(specs: readonly PtcToolSpec[]): string {
  if (specs.length === 0) return "- (no tools)";
  return specs.map((spec) => "- " + spec.signature + " — " + spec.description).join("\n");
}

/** Convert validator findings to JSON for the validate tool (no class instances). */
export function findingsJson(findings: readonly ValidationError[]): PtcJson[] {
  return findings.map((finding) => ({
    rule: finding.rule,
    file: finding.file,
    message: finding.message,
    fix_hint: finding.fix_hint,
    ...(finding.line === undefined ? {} : { line: finding.line }),
    ...(finding.excerpt === undefined ? {} : { excerpt: finding.excerpt }),
  }));
}

/** The typed error the router throws for a refused or invalid call. */
export class PtcToolError extends Error {
  readonly kind: PtcFailureKind;
  constructor(kind: PtcFailureKind, message: string) {
    super(message);
    this.name = "PtcToolError";
    this.kind = kind;
  }
}

export function isPtcToolError(value: unknown): value is PtcToolError {
  return value instanceof PtcToolError;
}

/** Message guards shared by the runner and the runner page tests. */
export function isToolRequest(value: unknown): value is { type: "tool"; id: number; name: string; args: unknown } {
  return (
    isRecord(value) &&
    value.type === "tool" &&
    typeof value.id === "number" &&
    typeof value.name === "string"
  );
}

export function isRunResultMessage(
  value: unknown,
): value is { type: "result"; value: PtcJson } | { type: "error"; kind: PtcFailureKind; message: string } {
  if (!isRecord(value)) return false;
  return value.type === "result" || value.type === "error";
}
