// Pure helpers for the preview CDP client (D-111): CDP payload shapes are untrusted JSON, so
// the parsing/formatting lives here and the client (preview-cdp.ts) stays within the line limit.

export type PreviewConsoleKind = "log" | "info" | "warn" | "error" | "exception";

export interface PreviewConsoleEntry {
  kind: PreviewConsoleKind;
  text: string;
}

export interface PreviewNetworkEntry {
  method: string;
  url: string;
  status?: number;
  error?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmed(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit) + "…";
}

/** One console argument as text: JSON.stringify only for values that are not DOM nodes. */
function argumentText(argument: unknown): string {
  if (!isRecord(argument)) return String(argument);
  if ("value" in argument) {
    const value = argument.value;
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  const description = argument.description;
  return typeof description === "string" ? description : String(argument.type ?? "?");
}

export function consoleText(params: Record<string, unknown>): string {
  if (!Array.isArray(params.args)) return "";
  return trimmed(params.args.map((argument) => argumentText(argument)).join(" "), 800);
}

export function exceptionText(params: Record<string, unknown>): string {
  const details = params.exceptionDetails;
  if (!isRecord(details)) return "uncaught exception";
  const exception = details.exception;
  if (isRecord(exception)) {
    const description = exception.description;
    if (typeof description === "string") return trimmed(description, 800);
    if ("value" in exception) return trimmed(String(exception.value), 800);
  }
  if (typeof details.text === "string") return trimmed(details.text, 800);
  return "uncaught exception";
}

/** Unwrap a `Runtime.evaluate` result: its JSON value, or the page's own error. */
export function evaluated(raw: unknown): unknown {
  if (!isRecord(raw)) throw new Error("the preview returned an unexpected CDP result");
  if (isRecord(raw.exceptionDetails)) {
    throw new Error("the page threw: " + exceptionText({ exceptionDetails: raw.exceptionDetails }));
  }
  const result = raw.result;
  if (!isRecord(result)) throw new Error("the preview returned no result");
  if ("value" in result) return result.value;
  return result.type === "undefined" ? null : (result.description ?? null);
}
