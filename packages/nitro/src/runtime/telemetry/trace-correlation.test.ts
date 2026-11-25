/**
 * FE↔BE trace correlation integration gate (issue #139, D-203 §4).
 *
 * Wires the real pieces end to end in-process: the RUM fetch-instrumentation config factory
 * (`@facilis.dev/rum/instrumentations`) driving the same FetchInstrumentation version RUM
 * registers, Nitro's http-span hooks consuming the injected `traceparent`, and the db driver
 * wrapper announcing the query under the request's trace. Two real SDK TracerProviders with
 * in-memory exporters stand in for the browser and the server; the ONLY thing connecting them
 * is the W3C header, exactly as in production. No network: fetch is stubbed and the exporters
 * are in-memory (D-200 — dev/test telemetry never leaves the machine).
 *
 * Spike F1: the web OTel line (api 1.9) and the server line (api 1.10) do not share runtime
 * globals, so the fetch instrumentation runs here on the server api line with RUM's exact
 * config and scrub processor. The correlation contract is the header handoff, which is
 * line-agnostic; the browser boot itself stays covered by the RUM unit suites.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SpanKind, TraceFlags, context, propagation } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import {
  ParentBasedSampler,
  StackContextManager,
  TraceIdRatioBasedSampler,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace";
import { instrumentPostgresClient, runWithQueryTrace, type QueryTrace } from "@facilis.dev/db";
// The config subpath is DOM-free: nitro typechecks its dependencies' sources without a DOM lib.
import type { RumConfig } from "@facilis.dev/rum/config";
import { buildInstrumentations } from "@facilis.dev/rum/instrumentations";
import { ScrubProcessor } from "@facilis.dev/rum/scrub";

import type { RouteMetadata, RouteMetadataMap } from "../../types.ts";
import { preflightResponse } from "../cors-policy.ts";
import {
  attributesOf,
  createSpanRecorder,
  spanAt,
  type SpanRecorder,
} from "../telemetry-test-harness.ts";
import { createHttpSpanHooks, type TelemetryEvent } from "./http-span.ts";
import { parseTraceparent } from "./traceparent.ts";

const ORIGIN = "https://app.example";
const API_ORIGIN = "https://api.example";
const SPA_ORIGIN = "https://spa.example";
const ROUTE_TEMPLATE = "/api/orders/:id";
/** A concrete path plus a query secret: neither may survive into any exported attribute. */
const ORDER_PATH = "/api/orders/42?token=secret";

const RUM_CONFIG: RumConfig = {
  tenantKey: "pub_write_only_1",
  endpoint: "/__facilis/telemetry/v1/traces",
  sampling: 1,
  serviceName: "acme-shop",
  deploymentId: null,
};

/** The sampler shape both production providers use (rum/provider.ts, telemetry/export.ts). */
function parentBased(rootSampling: number): ParentBasedSampler {
  return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(rootSampling) });
}

/**
 * RUM's scrub processor is typed against the web 2.x SDK line (F1); the only hook it uses is
 * onEnd mutating the live span's name/attributes, which the 3.x line hands it identically.
 */
function scrubProcessor(): SpanProcessor {
  return new ScrubProcessor() as unknown as SpanProcessor;
}

interface CapturedRequest {
  readonly url: string;
  readonly headers: Headers;
}

interface RigOptions {
  /** FE root sampling ratio; 0 makes the browser span (and its trace) unsampled. */
  readonly feSampling?: number;
  /** BE root sampling ratio; remote-parent decisions still win (parent-based). */
  readonly beSampling?: number;
  /** The page origin the web utilities read from `location`. */
  readonly pageOrigin?: string;
  /** The origin whose requests may carry traceparent (RUM's propagation allow-list). */
  readonly propagationOrigin?: string;
  /** nitro: the stub runs the server hooks + DB query; capture: headers only; unreachable: rejects. */
  readonly backend?: "nitro" | "capture" | "unreachable";
}

interface Rig {
  readonly fe: SpanRecorder;
  readonly be: SpanRecorder;
  readonly captured: CapturedRequest[];
}

const cleanups: Array<() => Promise<void>> = [];

/** The page `location` the web utilities need; Node has none, and no DOM is required. */
function stubLocation(origin: string): void {
  (globalThis as unknown as Record<string, unknown>)["location"] = {
    origin,
    href: origin + "/",
  };
}

function fakePool(): { query: (...args: unknown[]) => Promise<{ rows: unknown[] }> } {
  return { query: async () => ({ rows: [] }) };
}

/**
 * The fetch stub is the whole "server process": it receives the patched fetch call, runs the
 * Nitro request hook with the incoming headers, executes one traced query under the request's
 * query trace (the AsyncLocalStorage seam the real request wrapper uses), then responds.
 */
function nitroFetch(
  hooks: ReturnType<typeof createHttpSpanHooks>,
  pool: ReturnType<typeof instrumentPostgresClient<ReturnType<typeof fakePool>>>,
  captured: CapturedRequest[],
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    captured.push({ url: String(input), headers });
    const event: TelemetryEvent = {
      req: { method: init?.method ?? "GET", headers },
      context: { matchedRoute: { route: ROUTE_TEMPLATE } },
    };
    hooks.request(event);
    const queryTrace = (event.context as Record<string, unknown>)["trace"] as QueryTrace | undefined;
    await runWithQueryTrace(queryTrace, () =>
      pool.query("select * from orders where id = $1", [42]),
    );
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    hooks.response(response, event);
    return response;
  };
}

function captureFetch(captured: CapturedRequest[]): typeof fetch {
  return async (input, init) => {
    captured.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(null, { status: 200 });
  };
}

function unreachableFetch(captured: CapturedRequest[]): typeof fetch {
  return async (input, init) => {
    captured.push({ url: String(input), headers: new Headers(init?.headers) });
    throw new Error("network unreachable");
  };
}

function boot(options: RigOptions = {}): Rig {
  const fe = createSpanRecorder({
    sampler: parentBased(options.feSampling ?? 1),
    beforeExport: [scrubProcessor()],
  });
  const be = createSpanRecorder({ sampler: parentBased(options.beSampling ?? 1) });
  const captured: CapturedRequest[] = [];
  const stub =
    options.backend === "capture"
      ? captureFetch(captured)
      : options.backend === "unreachable"
        ? unreachableFetch(captured)
        : nitroFetch(createHttpSpanHooks(be.tracer), instrumentPostgresClient(fakePool()), captured);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stub;
  stubLocation(options.pageOrigin ?? ORIGIN);
  const instrumentation = new FetchInstrumentation(
    buildInstrumentations(RUM_CONFIG, options.propagationOrigin ?? ORIGIN).fetch,
  );
  instrumentation.setTracerProvider(fe.provider);
  instrumentation.enable();
  cleanups.push(async () => {
    instrumentation.disable();
    globalThis.fetch = originalFetch;
    delete (globalThis as unknown as Record<string, unknown>)["location"];
    await fe.shutdown();
    await be.shutdown();
  });
  return { fe, be, captured };
}

/** The fetch instrumentation ends its span ~300 ms after the response (observer wait). */
async function waitForSpans(recorder: SpanRecorder, count: number): Promise<void> {
  await vi.waitFor(() => expect(recorder.spans().length).toBeGreaterThanOrEqual(count), {
    timeout: 5_000,
    interval: 20,
  });
}

/** Let a non-recording or ignored fetch settle without exporting anything. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400));
}

beforeAll(() => {
  // 3.x removed provider.register() (spike F2): the fetch instrumentation injects through the
  // global propagator and reads the active context, so both are registered explicitly. The
  // stack manager suffices: injection happens synchronously inside the patched fetch call.
  context.setGlobalContextManager(new StackContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});

afterAll(() => {
  context.disable();
  propagation.disable();
});

afterEach(async () => {
  // Sequential, in reverse boot order: each rig restores the globals it replaced. The chain
  // keeps the order without awaiting inside the loop.
  let chain = Promise.resolve();
  for (const cleanup of cleanups.splice(0).toReversed()) chain = chain.then(cleanup);
  await chain;
});

describe("FE → Nitro → DB trace correlation (D-203 §4)", () => {
  it("shares one trace-id across fetch, request and query spans, parented in order", async () => {
    const rig = boot();

    // A relative same-origin fetch, as the SPA issues it; the patch resolves it via location.
    const response = await fetch(ORDER_PATH);
    expect(response.status).toBe(200);
    await waitForSpans(rig.fe, 1);

    const feSpan = spanAt(rig.fe, 0);
    // The query ends before the response hook, so it exports first.
    const dbSpan = spanAt(rig.be, 0);
    const requestSpan = spanAt(rig.be, 1);

    const traceIds = new Set(
      [feSpan, requestSpan, dbSpan].map((span) => span.spanContext().traceId),
    );
    expect(traceIds.size).toBe(1);
    expect(requestSpan.parentSpanContext?.spanId).toBe(feSpan.spanContext().spanId);
    expect(dbSpan.parentSpanContext?.spanId).toBe(requestSpan.spanContext().spanId);
    expect(feSpan.kind).toBe(SpanKind.CLIENT);
    expect(requestSpan.kind).toBe(SpanKind.SERVER);
    expect(dbSpan.kind).toBe(SpanKind.CLIENT);

    // The header carried exactly the FE span's context, and the sampled decision survived
    // every hop: FE span, traceparent, request span and query span all agree.
    const header = parseTraceparent(rig.captured[0]?.headers.get("traceparent"));
    expect(header?.traceId).toBe(feSpan.spanContext().traceId);
    expect(header?.spanId).toBe(feSpan.spanContext().spanId);
    expect(header?.traceFlags).toBe(TraceFlags.SAMPLED);
    for (const span of [feSpan, requestSpan, dbSpan]) {
      expect(span.spanContext().traceFlags).toBe(TraceFlags.SAMPLED);
    }
  });

  it("exports only framework vocabulary: templated paths, no query strings or values", async () => {
    const rig = boot();
    await fetch(ORDER_PATH);
    await waitForSpans(rig.fe, 1);

    const feSpan = spanAt(rig.fe, 0);
    const dbSpan = spanAt(rig.be, 0);
    const requestSpan = spanAt(rig.be, 1);

    // The browser instrumentation emits legacy semconv keys (spike F6); RUM's scrub keeps the
    // allowlisted ones and reduces the URL to the templated pathname — query and host never leave.
    expect(attributesOf(feSpan)).toEqual({
      "http.method": "GET",
      "http.url": "/api/orders/:id",
      "http.status_code": 200,
      "http.host": "app.example",
      "http.scheme": "https",
    });
    expect(attributesOf(requestSpan)).toEqual({
      "http.request.method": "GET",
      "http.response.status_code": 200,
      "http.route": ROUTE_TEMPLATE,
    });
    expect(attributesOf(dbSpan)).toEqual({
      "db.system.name": "postgresql",
      "db.operation.name": "select",
      "db.collection.name": "orders",
    });
    expect(feSpan.name).toBe("HTTP GET");
    expect(requestSpan.name).toBe("GET " + ROUTE_TEMPLATE);
    expect(dbSpan.name).toBe("SELECT orders");

    // Neither the query secret nor the concrete id nor the bind value appears anywhere.
    const payload = JSON.stringify([feSpan, requestSpan, dbSpan].map((s) => attributesOf(s)));
    expect(payload).not.toContain("secret");
    expect(payload).not.toContain("token");
    expect(payload).not.toContain("42");
  });

  it("propagates an unsampled parent consistently: flags 00, nothing recorded on either side", async () => {
    const rig = boot({ feSampling: 0 });
    await fetch(ORDER_PATH);
    await settle();

    // The client still generates a trace-id and injects it; only the sampled bit is off.
    const header = parseTraceparent(rig.captured[0]?.headers.get("traceparent"));
    expect(header).not.toBeNull();
    expect(header?.traceId).toMatch(/^[0-9a-f]{32}$/);
    // The API enum names only SAMPLED (1); the unsampled decision is the absence of the bit.
    expect(header?.traceFlags).toBe(0);
    // Parent-based sampling: the FE root decision drops the FE span, and the remote unsampled
    // parent drops the server spans even though the BE root sampler keeps everything.
    expect(rig.fe.spans()).toEqual([]);
    expect(rig.be.spans()).toEqual([]);
  });

  it("honors a sampled remote parent even when the local root sampler drops", async () => {
    const rig = boot({ beSampling: 0 });
    await fetch(ORDER_PATH);
    await waitForSpans(rig.fe, 1);

    // Parent-based: remoteParentSampled wins over the BE root ratio, so the trace stays whole.
    expect(rig.be.spans()).toHaveLength(2);
    expect(spanAt(rig.be, 1).spanContext().traceFlags).toBe(TraceFlags.SAMPLED);
    expect(spanAt(rig.be, 1).spanContext().traceId).toBe(spanAt(rig.fe, 0).spanContext().traceId);
  });

  it("propagates cross-origin only to the allow-listed API origin, never third parties", async () => {
    // The page sits on a different origin than the API: propagation now goes through the CORS
    // allow-list (the same regex RUM builds), not the same-origin shortcut.
    const rig = boot({
      pageOrigin: SPA_ORIGIN,
      propagationOrigin: API_ORIGIN,
      backend: "capture",
    });

    await fetch(API_ORIGIN + ORDER_PATH);
    await waitForSpans(rig.fe, 1);
    expect(rig.captured[0]?.headers.get("traceparent")).not.toBeNull();

    await fetch("https://third-party.example/collect");
    await waitForSpans(rig.fe, 2);
    expect(rig.captured[1]?.headers.get("traceparent")).toBeNull();
  });

  it("leaves an orphan FE span with a client-generated trace-id when the backend is unreachable", async () => {
    const rig = boot({ backend: "unreachable" });
    await expect(fetch(ORDER_PATH)).rejects.toThrow("network unreachable");
    await waitForSpans(rig.fe, 1);

    // The browser span exists and carries the context it injected before the failure; there is
    // no server counterpart, so at the collector this trace is an orphan (see README/D-203 §4).
    const feSpan = spanAt(rig.fe, 0);
    const header = parseTraceparent(rig.captured[0]?.headers.get("traceparent"));
    expect(header?.traceId).toBe(feSpan.spanContext().traceId);
    expect(feSpan.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(rig.be.spans()).toEqual([]);
  });

  it("never instruments the ingestion export itself", async () => {
    const rig = boot({ backend: "capture" });
    await fetch(ORIGIN + RUM_CONFIG.endpoint, { method: "POST" });
    await settle();

    // The export path is ignored (no span, no traceparent): an ad-blocked export can never
    // feed itself, and API tracing is independent of whether the export succeeds.
    expect(rig.fe.spans()).toEqual([]);
    expect(rig.captured[0]?.headers.get("traceparent")).toBeNull();
  });

  it("answers a cross-origin preflight with traceparent in Access-Control-Allow-Headers", () => {
    // The framework's CORS policy echoes the requested headers, so a preflight asking for
    // traceparent is allowed; a cross-origin operator proxy must do the same (D-203 §4).
    const route: RouteMetadata = {
      method: "GET",
      path: "/api/orders/{id}",
      dbTables: [],
      dbColumns: [],
      unresolved: [],
      warnings: [],
    };
    const metadata: RouteMetadataMap = { "/api/orders/{id}": { get: route } };
    const requestHeaders = new Headers({
      origin: SPA_ORIGIN,
      "access-control-request-method": "GET",
      "access-control-request-headers": "traceparent",
    });

    const response = preflightResponse(metadata, "/api/orders/{id}", requestHeaders, [SPA_ORIGIN]);
    expect(response?.status).toBe(204);
    expect(response?.headers.get("access-control-allow-headers")).toContain("traceparent");
  });
});
