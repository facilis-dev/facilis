// The one place the IDE talks HTTP to an LLM (D-045/D-046).
//
// Callers get a ChatFailure instead of an exception: the chat session renders
// error state, and a rejected promise here would surface as an unhandled one at
// the click site. The key only ever lives in the auth header built by
// buildRequest; nothing in this module logs, and errors never echo it.

import { mockAnswer } from "./mock";
import { buildRequest, isConfigured, parseProviderEvent, presetFor } from "./providers";
import { readSse } from "./sse";
import type { AiChatTurn, AiSettings, ChatFailure } from "./types";

export interface CallModelInput {
  settings: AiSettings;
  system: string;
  messages: readonly AiChatTurn[];
  signal?: AbortSignal;
  onText?: (chunk: string) => void;
}

export type CallModelResult =
  | {
      ok: true;
      text: string;
      /** The provider stopped at its output limit, so the answer is incomplete. */
      truncated?: boolean;
    }
  | { ok: false; failure: ChatFailure };

/** A provider error body is detail, not a payload: cap it for the bubble. */
const ERROR_BODY_LIMIT = 300;

function failed(kind: ChatFailure["kind"], message: string, status?: number): CallModelResult {
  return {
    ok: false,
    failure: status === undefined ? { kind, message } : { kind, message, status },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function capped(text: string): string {
  const value = text.trim();
  return value.length > ERROR_BODY_LIMIT ? value.slice(0, ERROR_BODY_LIMIT) + "..." : value;
}

/** `{ error: { message } }`, `{ error: "..." }` or `{ message }`; else raw text. */
function providerMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed)) {
      const direct = parsed.error;
      if (typeof direct === "string") return capped(direct);
      if (isRecord(direct) && typeof direct.message === "string") return capped(direct.message);
      if (typeof parsed.message === "string") return capped(parsed.message);
    }
  } catch {
    // Not JSON: the body itself is the detail.
  }
  return capped(body);
}

async function httpFailure(response: Response): Promise<CallModelResult> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    // The status alone still tells the user what happened.
  }
  const detail = body.length > 0 ? providerMessage(body) : "";
  return failed("http", detail || "HTTP " + response.status, response.status);
}

/** The mock answers in small chunks so the streaming UI is demonstrable offline. */
async function trickleMock(
  text: string,
  onText: ((chunk: string) => void) | undefined,
): Promise<void> {
  if (onText === undefined) return;
  const chunkSize = 24;
  for (let index = 0; index < text.length; index += chunkSize) {
    onText(text.slice(index, index + chunkSize));
    // A visible trickle; the panel throttles its own re-renders.
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

export async function callModel(input: CallModelInput): Promise<CallModelResult> {
  const { settings, signal } = input;
  if (signal?.aborted) return failed("aborted", "The request was cancelled.");

  if (settings.providerId === "mock") {
    if (!import.meta.env.DEV) {
      return failed("unsupported", "The mock provider is only available in development builds.");
    }
    const text = mockAnswer(input.messages);
    await trickleMock(text, input.onText);
    return { ok: true, text };
  }

  const preset = presetFor(settings);
  if (!preset || !isConfigured(settings, preset)) {
    return failed("unsupported", "No AI provider is configured.");
  }

  const request = buildRequest(preset, settings, input.system, input.messages);
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      return failed("aborted", "The request was cancelled.");
    }
    return failed("network", errorText(error));
  }

  if (!response.ok) return httpFailure(response);
  if (response.body === null) return failed("stream", "The provider response had no body.");

  let text = "";
  let stopReason: string | undefined;
  try {
    await readSse(response.body, (data) => {
      if (data === "[DONE]") return;
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        throw new Error("The provider sent a stream event that is not JSON.");
      }
      const event = parseProviderEvent(preset.protocol, payload);
      if (event.error !== undefined) throw new Error(event.error);
      if (event.stopReason !== undefined) stopReason = event.stopReason;
      if (event.text !== undefined) {
        text += event.text;
        input.onText?.(event.text);
      }
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      return failed("aborted", "The request was cancelled.");
    }
    return failed("stream", errorText(error));
  }

  if (text.length === 0) return failed("empty", "The provider returned no text.");
  // "length"/"max_tokens" means the provider cut the answer at its output limit, so the
  // patch-set JSON cannot be complete: the turn loop requests the rest in parts (D-106).
  if (stopReason === "length" || stopReason === "max_tokens") {
    return { ok: true, text, truncated: true };
  }
  return { ok: true, text };
}
