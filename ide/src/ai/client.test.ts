import { afterEach, describe, expect, it, vi } from "vitest";
import { callModel } from "./client";
import { mockAnswer } from "./mock";
import type { AiSettings } from "./types";

const encoder = new TextEncoder();

const openAi: AiSettings = {
  providerId: "custom",
  apiKey: "sk-secret",
  model: "test-model",
  baseUrl: "http://provider.test/v1/",
};

const anthropic: AiSettings = {
  providerId: "anthropic",
  apiKey: "sk-ant",
  model: "claude-sonnet-4-5",
  baseUrl: "",
};

const mock: AiSettings = { providerId: "mock", apiKey: "", model: "mock", baseUrl: "" };

type FetchHandler = (url: string, init: RequestInit) => Promise<Response>;

function stubFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((url: string, init: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function responseFrom(chunks: readonly string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status });
}

function brokenStream(): Response {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
        );
        return;
      }
      controller.error(new Error("socket reset"));
    },
  });
  return new Response(body, { status: 200 });
}

function openAiFrames(parts: readonly string[]): string[] {
  return [
    ...parts.map(
      (part) => 'data: {"choices":[{"delta":{"content":' + JSON.stringify(part) + "}}]}\n\n",
    ),
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ];
}

function anthropicFrames(parts: readonly string[]): string[] {
  return [
    ...parts.map(
      (part) =>
        "event: content_block_delta\ndata: " +
        JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: part } }) +
        "\n\n",
    ),
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("callModel", () => {
  it("streams and concatenates an OpenAI answer, calling onText per chunk", async () => {
    const fetchMock = stubFetch(async () => responseFrom(openAiFrames(["He", "llo"])));
    const chunks: string[] = [];
    const result = await callModel({
      settings: openAi,
      system: "",
      messages: [{ role: "user", content: "hi" }],
      onText: (chunk) => chunks.push(chunk),
    });

    expect(result).toEqual({ ok: true, text: "Hello" });
    expect(chunks).toEqual(["He", "llo"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://provider.test/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer sk-secret" });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "test-model", stream: true });
  });

  it("streams and concatenates an Anthropic answer", async () => {
    const fetchMock = stubFetch(async () => responseFrom(anthropicFrames(["Bon", "jour"])));
    const result = await callModel({
      settings: anthropic,
      system: "SYSTEM",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toEqual({ ok: true, text: "Bonjour" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "sk-ant" });
  });

  it("maps a non-2xx JSON error to http with the provider message", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }),
    );
    const result = await callModel({ settings: openAi, system: "", messages: [] });
    expect(result).toEqual({
      ok: false,
      failure: { kind: "http", status: 401, message: "invalid api key" },
    });
  });

  it("caps a long plain-text error body", async () => {
    stubFetch(async () => new Response("x".repeat(400), { status: 429 }));
    const result = await callModel({ settings: openAi, system: "", messages: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("http");
    expect(result.failure.status).toBe(429);
    expect(result.failure.message.length).toBe(303);
  });

  it("maps a rejected fetch to network", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await callModel({ settings: openAi, system: "", messages: [] });
    expect(result).toEqual({ ok: false, failure: { kind: "network", message: "fetch failed" } });
  });

  it("reports a pre-aborted signal without fetching", async () => {
    const fetchMock = stubFetch(async () => responseFrom([]));
    const controller = new AbortController();
    controller.abort();
    const result = await callModel({
      settings: openAi,
      system: "",
      messages: [],
      signal: controller.signal,
    });
    expect(result).toMatchObject({ ok: false, failure: { kind: "aborted" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an empty stream as empty", async () => {
    stubFetch(async () => responseFrom(["data: [DONE]\n\n"]));
    const result = await callModel({ settings: openAi, system: "", messages: [] });
    expect(result).toEqual({
      ok: false,
      failure: { kind: "empty", message: "The provider returned no text." },
    });
  });

  it("maps malformed stream JSON and provider error events to stream", async () => {
    stubFetch(async () => responseFrom(["data: not json\n\n"]));
    const malformed = await callModel({ settings: openAi, system: "", messages: [] });
    expect(malformed).toMatchObject({ ok: false, failure: { kind: "stream" } });

    stubFetch(async () => responseFrom(['data: {"error":{"message":"overloaded"}}\n\n']));
    const providerError = await callModel({ settings: openAi, system: "", messages: [] });
    expect(providerError).toEqual({
      ok: false,
      failure: { kind: "stream", message: "overloaded" },
    });
  });

  it("maps a stream that dies mid-answer to stream", async () => {
    stubFetch(async () => brokenStream());
    const result = await callModel({ settings: openAi, system: "", messages: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("stream");
    expect(result.failure.message).toContain("socket reset");
  });

  it("serves the mock without fetching and calls onText once", async () => {
    const fetchMock = stubFetch(async () => responseFrom([]));
    const seen: string[] = [];
    const messages = [{ role: "user" as const, content: "add a file" }];
    const result = await callModel({
      settings: mock,
      system: "",
      messages,
      onText: (chunk) => seen.push(chunk),
    });

    expect(result).toEqual({ ok: true, text: mockAnswer(messages) });
    expect(seen).toEqual([mockAnswer(messages)]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the mock in production builds", async () => {
    const fetchMock = stubFetch(async () => responseFrom([]));
    vi.stubEnv("DEV", false);
    const result = await callModel({ settings: mock, system: "", messages: [] });
    expect(result).toMatchObject({ ok: false, failure: { kind: "unsupported" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
