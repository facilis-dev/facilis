// Pure helpers for the preview CDP client (D-111/D-112): CDP payload shapes are untrusted JSON,
// so parsing/formatting and the event buffers live here and the client (preview-cdp.ts) stays
// within the line limit.

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

/** One screencast frame as chobitsu emits it: base64 JPEG plus the device size (D-112). */
export interface PreviewScreenshot {
  data: string;
  width: number;
  height: number;
}

/** The per-tab event buffers the client keeps (a tab's state extends this). */
export interface PreviewBuffers {
  console: PreviewConsoleEntry[];
  network: Map<string, PreviewNetworkEntry>;
}

const CONSOLE_BUFFER = 80;
const NETWORK_BUFFER = 120;

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

/**
 * Feed one CDP event into a tab's buffers. Returns the frame when the event is a screencast
 * frame (a screenshot capture is waiting for it, D-112), null otherwise.
 */
export function applyPreviewEvent(
  buffers: PreviewBuffers,
  method: string,
  params: unknown,
): PreviewScreenshot | null {
  if (!isRecord(params)) return null;
  if (method === "Page.screencastFrame") {
    if (typeof params.data !== "string") return null;
    const metadata = isRecord(params.metadata) ? params.metadata : {};
    return {
      data: params.data,
      width: typeof metadata.deviceWidth === "number" ? metadata.deviceWidth : 0,
      height: typeof metadata.deviceHeight === "number" ? metadata.deviceHeight : 0,
    };
  }
  if (method === "Runtime.consoleAPICalled") {
    const kind = typeof params.type === "string" ? params.type : "log";
    buffers.console.push({
      kind: (kind === "warning" ? "warn" : kind) as PreviewConsoleKind,
      text: consoleText(params),
    });
    if (buffers.console.length > CONSOLE_BUFFER) buffers.console.shift();
    return null;
  }
  if (method === "Runtime.exceptionThrown") {
    buffers.console.push({ kind: "exception", text: exceptionText(params) });
    if (buffers.console.length > CONSOLE_BUFFER) buffers.console.shift();
    return null;
  }
  if (method === "Network.requestWillBeSent") {
    const request = params.request;
    if (!isRecord(request)) return null;
    const requestId = typeof params.requestId === "string" ? params.requestId : "";
    if (requestId === "") return null;
    const url = typeof request.url === "string" ? request.url : "";
    const requestMethod = typeof request.method === "string" ? request.method : "GET";
    buffers.network.set(requestId, { method: requestMethod, url });
    const oldest = buffers.network.keys().next().value;
    if (buffers.network.size > NETWORK_BUFFER && oldest !== undefined) {
      buffers.network.delete(oldest);
    }
    return null;
  }
  if (method === "Network.responseReceived") {
    const requestId = typeof params.requestId === "string" ? params.requestId : "";
    const entry = buffers.network.get(requestId);
    const response = params.response;
    if (entry === undefined || !isRecord(response)) return null;
    if (typeof response.status === "number") entry.status = response.status;
    return null;
  }
  if (method === "Network.loadingFailed") {
    const requestId = typeof params.requestId === "string" ? params.requestId : "";
    const entry = buffers.network.get(requestId);
    if (entry === undefined) return null;
    entry.error =
      typeof params.errorText === "string" && params.errorText.length > 0
        ? params.errorText
        : "request failed";
  }
  return null;
}
