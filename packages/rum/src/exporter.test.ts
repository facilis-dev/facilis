import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import type { Context, ContextManager } from "@opentelemetry/api";
import { isTracingSuppressed } from "@opentelemetry/core";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-web";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-web";
import type { RumConfig } from "./config.ts";
import { createRumExporter } from "./exporter.ts";

const CONFIG: RumConfig = {
  tenantKey: "pub_write_only_1",
  endpoint: "/__facilis/telemetry/v1/traces",
  sampling: 1,
  serviceName: "acme-shop",
  deploymentId: null,
};

// A real SDK span: hand-built ReadableSpan fakes drift from the serializer's expectations.
function realSpan(name: string, attributes: Record<string, string | number>): ReadableSpan {
  let captured: ReadableSpan | undefined;
  const provider = new BasicTracerProvider({
    spanProcessors: [
      {
        onStart(): void {},
        onEnd(span: ReadableSpan): void {
          captured = span;
        },
        shutdown: () => Promise.resolve(),
        forceFlush: () => Promise.resolve(),
      },
    ],
  });
  provider.getTracer("rum-test").startSpan(name, { attributes }).end();
  if (captured === undefined) throw new Error("fixture span was not captured");
  return captured;
}

// The node environment has no context manager: install a minimal stack-based one so the
// suppressTracing assertion observes the same context the exporter's fetch runs under.
const stack: Context[] = [];
const manager: ContextManager = {
  active: () => stack[stack.length - 1] ?? ROOT_CONTEXT,
  with: (ctx, fn, thisArg, ...args) => {
    stack.push(ctx);
    try {
      return fn.call(thisArg, ...args);
    } finally {
      stack.pop();
    }
  },
  bind: (_ctx, target) => target,
  enable: () => manager,
  disable: () => manager,
};
beforeAll(() => {
  context.setGlobalContextManager(manager);
});
afterAll(() => {
  context.disable();
});

interface FetchCall {
  url: string;
  init: RequestInit;
  suppressed: boolean;
}
const calls: FetchCall[] = [];
const originalFetch = globalThis.fetch;
let fetchBehavior: (url: string, init: RequestInit) => Promise<Response> = () =>
  Promise.resolve(new Response("{}", { status: 200 }));

afterEach(() => {
  calls.length = 0;
  globalThis.fetch = originalFetch;
  fetchBehavior = () => Promise.resolve(new Response("{}", { status: 200 }));
});

function stubFetch(): void {
  (globalThis as Record<string, unknown>).fetch = (url: string, init: RequestInit) => {
    calls.push({ url, init, suppressed: isTracingSuppressed(context.active()) });
    return fetchBehavior(url, init);
  };
}

function exportOnce(spans: ReadableSpan[]): Promise<{ code: number }> {
  return new Promise((resolve) => {
    createRumExporter(CONFIG).export(spans, resolve);
  });
}

describe("createRumExporter — payload", () => {
  it("POSTs OTLP/JSON to the ingestion route with the public tenant key header", async () => {
    stubFetch();
    const result = await exportOnce([
      realSpan("browser.web_vital", { "browser.web_vital.name": "LCP" }),
    ]);
    expect(result).toEqual({ code: 0 });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) throw new Error("fetch was not called");
    expect(call.url).toBe(CONFIG.endpoint);
    expect(call.init.method).toBe("POST");
    expect(call.init.keepalive).toBe(true);
    const headers = call.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-facilis-telemetry-key"]).toBe(CONFIG.tenantKey);
    const body = JSON.parse(new TextDecoder().decode(call.init.body as Uint8Array)) as {
      resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[];
    };
    expect(body.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.name).toBe("browser.web_vital");
  });

  it("runs the export under suppressTracing so it is never traced itself", async () => {
    stubFetch();
    await exportOnce([realSpan("browser.error", { "error.type": "Error" })]);
    expect(calls[0]?.suppressed).toBe(true);
  });

  it("carries an abort signal (the 3s export timeout)", async () => {
    stubFetch();
    await exportOnce([realSpan("browser.web_vital", { "browser.web_vital.name": "CLS" })]);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("createRumExporter — failures stay silent", () => {
  it("resolves success when fetch rejects (no retries, never breaks the app)", async () => {
    stubFetch();
    fetchBehavior = () => Promise.reject(new Error("network down"));
    await expect(exportOnce([realSpan("browser.error", {})])).resolves.toEqual({ code: 0 });
  });

  it("resolves success on a non-OK ingestion answer", async () => {
    stubFetch();
    fetchBehavior = () => Promise.resolve(new Response("{}", { status: 429 }));
    await expect(exportOnce([realSpan("browser.error", {})])).resolves.toEqual({ code: 0 });
  });

  it("does not throw when fetch throws synchronously", async () => {
    (globalThis as Record<string, unknown>).fetch = () => {
      throw new Error("broken fetch");
    };
    await expect(exportOnce([realSpan("browser.error", {})])).resolves.toEqual({ code: 0 });
  });

  it("shutdown and forceFlush resolve", async () => {
    const exporter = createRumExporter(CONFIG);
    await expect(exporter.shutdown()).resolves.toBeUndefined();
    // forceFlush is optional on the SpanExporter interface; ours implements it.
    if (exporter.forceFlush === undefined) throw new Error("forceFlush missing");
    await expect(exporter.forceFlush()).resolves.toBeUndefined();
  });
});
