// Message protocol shared by the editor-side client and the analyzer worker (task-6).
//
// The worker module imports the wasm parser and cannot be loaded by Vitest, so the protocol
// lives here as plain data + guards: both boundaries validate, and the guards are testable
// without booting the parser.

import type { Analysis } from "@facilis/analyze";

/** One `[project-relative path, source]` pair. Plain arrays survive structured clone. */
export type AnalysisFileEntry = readonly [path: string, source: string];

export interface AnalyzeRequest {
  readonly type: "analyze";
  readonly files: readonly AnalysisFileEntry[];
}

/** Sent once, after the wasm module's top-level await settled (findings §4.2). */
export interface ReadyMessage {
  readonly type: "ready";
}

export interface ResultMessage {
  readonly type: "result";
  readonly analysis: Analysis;
}

export interface ErrorMessage {
  readonly type: "error";
  readonly message: string;
}

export type AnalyzeWorkerMessage = ReadyMessage | ResultMessage | ErrorMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isReadyMessage(value: unknown): value is ReadyMessage {
  return isRecord(value) && value["type"] === "ready";
}

export function isErrorMessage(value: unknown): value is ErrorMessage {
  return isRecord(value) && value["type"] === "error" && typeof value["message"] === "string";
}

/** Cheap structural check of the fact model; the analyzer produced it, so shape is enough. */
export function isAnalysis(value: unknown): value is Analysis {
  if (!isRecord(value)) return false;
  if (typeof value["revision"] !== "string") return false;
  if (!isStringArray(value["files"])) return false;
  if (!isRecord(value["config"]) || !isRecord(value["locales"])) return false;
  for (const field of ["routes", "tables", "relations", "pages", "diagnostics"] as const) {
    if (!Array.isArray(value[field])) return false;
  }
  const graph = value["graph"];
  return isRecord(graph) && Array.isArray(graph["nodes"]) && Array.isArray(graph["edges"]);
}

export function isResultMessage(value: unknown): value is ResultMessage {
  return isRecord(value) && value["type"] === "result" && isAnalysis(value["analysis"]);
}

/** Validates a worker-facing request; used by the worker and by the client's tests. */
export function isAnalyzeRequest(value: unknown): value is AnalyzeRequest {
  if (!isRecord(value) || value["type"] !== "analyze" || !Array.isArray(value["files"])) {
    return false;
  }
  return value["files"].every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string",
  );
}

/** Serialize the read snapshot into the request payload. */
export function toAnalyzeRequest(files: ReadonlyMap<string, string>): AnalyzeRequest {
  return {
    type: "analyze",
    files: [...files].map(([path, source]) => [path, source] as const),
  };
}
