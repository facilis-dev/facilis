import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEPLOYMENT_ID_ENV,
  TELEMETRY_ENDPOINT_ENV,
  TELEMETRY_ENV,
  TELEMETRY_SERVICE_ENV,
} from "./config.ts";
import { createTelemetryPipeline, type TelemetryExportConfig } from "./export.ts";
import { activeTelemetry, bootstrapTelemetry, installTelemetryRuntime } from "./runtime.ts";

interface CollectorRequest {
  readonly path: string;
  readonly contentType: string | undefined;
  readonly body: Buffer;
}

interface CollectorAnswer {
  readonly status: number;
  readonly headers?: Record<string, string>;
}

interface TestCollector {
  readonly endpoint: string;
  readonly requests: CollectorRequest[];
  readonly close: () => Promise<void>;
}

const collectors: TestCollector[] = [];

/** A real OTLP/HTTP collector: it answers like one and keeps what the exporter sent. */
async function startCollector(
  answer: (request: CollectorRequest, index: number) => CollectorAnswer = () => ({ status: 200 }),
): Promise<TestCollector> {
  const requests: CollectorRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request: CollectorRequest = {
        path: req.url ?? "",
        contentType: req.headers["content-type"],
        body: Buffer.concat(chunks),
      };
      requests.push(request);
      const reply = answer(request, requests.length - 1);
      res.writeHead(reply.status, reply.headers ?? {});
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the test collector did not bind a TCP port");
  }
  const collector: TestCollector = {
    endpoint: "http://127.0.0.1:" + address.port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        // Keep-alive sockets would otherwise hold the server open past the test.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  collectors.push(collector);
  return collector;
}

function configFor(endpoint: string): TelemetryExportConfig {
  return { endpoint, sampling: 1, serviceName: "acme-shop", deploymentId: "dep-42" };
}

/** The env a managed deploy boots with, reduced to what telemetry reads. */
function deployEnv(endpoint: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    [TELEMETRY_ENV]: "on",
    [TELEMETRY_ENDPOINT_ENV]: endpoint,
    [TELEMETRY_SERVICE_ENV]: "acme-shop",
    [DEPLOYMENT_ID_ENV]: "dep-42",
  };
}

/** The payload is protobuf; its attribute keys and names are still readable as raw bytes. */
function textOf(request: CollectorRequest | undefined): string {
  return request?.body.toString("latin1") ?? "";
}

async function eventually(check: () => boolean, timeoutMillis = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMillis;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("the collector did not receive the export in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  installTelemetryRuntime(null);
  await Promise.all(collectors.splice(0).map((collector) => collector.close()));
});

describe("createTelemetryPipeline", () => {
  it("exports an ended span to the collector with the service's resource attributes", async () => {
    const collector = await startCollector();
    // A delay far beyond the test: the span can only arrive through the shutdown flush.
    const pipeline = createTelemetryPipeline(configFor(collector.endpoint), {
      scheduledDelayMillis: 60_000,
    });

    const span = pipeline.tracer.startSpan("GET /orders/:id");
    span.setAttribute("http.route", "/orders/:id");
    span.end();
    await pipeline.shutdown();

    expect(collector.requests.map((request) => request.path)).toEqual(["/v1/traces"]);
    const request = collector.requests[0];
    expect(request?.contentType).toBe("application/x-protobuf");
    expect(request?.body.byteLength).toBeGreaterThan(0);
    const payload = textOf(request);
    expect(payload).toContain("GET /orders/:id");
    expect(payload).toContain("service.name");
    expect(payload).toContain("acme-shop");
    expect(payload).toContain("deployment.id");
    expect(payload).toContain("dep-42");
  });

  it("batches spans into one export instead of one request per span", async () => {
    const collector = await startCollector();
    const pipeline = createTelemetryPipeline(configFor(collector.endpoint), {
      scheduledDelayMillis: 20,
      maxExportBatchSize: 64,
    });

    pipeline.tracer.startSpan("GET /orders").end();
    pipeline.tracer.startSpan("POST /orders").end();
    await eventually(() => collector.requests.length === 1);

    expect(collector.requests).toHaveLength(1);
    const payload = textOf(collector.requests[0]);
    expect(payload).toContain("GET /orders");
    expect(payload).toContain("POST /orders");
    await pipeline.shutdown();
  });

  it("retries a retryable failure and delivers the batch on the next attempt", async () => {
    // No Retry-After: the exporter's own backoff must schedule the second attempt.
    const collector = await startCollector((_request, index) =>
      index === 0 ? { status: 503 } : { status: 200 },
    );
    const pipeline = createTelemetryPipeline(configFor(collector.endpoint), {
      scheduledDelayMillis: 60_000,
    });

    pipeline.tracer.startSpan("GET /health").end();
    await pipeline.shutdown();

    expect(collector.requests).toHaveLength(2);
    expect(collector.requests.every((request) => request.path === "/v1/traces")).toBe(true);
    expect(textOf(collector.requests[1])).toContain("GET /health");
  });

  it("exports nothing when the deploy samples no traces", async () => {
    const collector = await startCollector();
    const pipeline = createTelemetryPipeline(
      { ...configFor(collector.endpoint), sampling: 0 },
      { scheduledDelayMillis: 10 },
    );

    pipeline.tracer.startSpan("GET /orders").end();
    await pipeline.shutdown();

    expect(collector.requests).toEqual([]);
  });

  it("exports metrics through the periodic reader on shutdown", async () => {
    const collector = await startCollector();
    const pipeline = createTelemetryPipeline(configFor(collector.endpoint));

    pipeline.meter.createCounter("facilis.test.requests").add(1, { "http.route": "/orders" });
    await pipeline.shutdown();

    const metricsRequest = collector.requests.find((request) => request.path === "/v1/metrics");
    expect(metricsRequest).toBeDefined();
    expect(textOf(metricsRequest)).toContain("facilis.test.requests");
    expect(textOf(metricsRequest)).toContain("acme-shop");
  });
});

describe("bootstrapTelemetry", () => {
  it("installs the pipeline a deploy enabled and exports through it", async () => {
    const collector = await startCollector();
    const installation = bootstrapTelemetry(deployEnv(collector.endpoint), {
      scheduledDelayMillis: 60_000,
    });
    expect(installation).not.toBeNull();
    expect(activeTelemetry()).not.toBeNull();

    activeTelemetry()?.tracer.startSpan("GET /orders").end();
    await installation?.shutdown();

    expect(collector.requests.map((request) => request.path)).toEqual(["/v1/traces"]);
    expect(textOf(collector.requests[0])).toContain("GET /orders");
  });

  it("installs nothing when disabled, in dev, or in test", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const endpoint = "http://127.0.0.1:9";

    for (const env of [
      { NODE_ENV: "production" },
      { NODE_ENV: "development", [TELEMETRY_ENV]: "on", [TELEMETRY_ENDPOINT_ENV]: endpoint },
      { NODE_ENV: "test", [TELEMETRY_ENV]: "on", [TELEMETRY_ENDPOINT_ENV]: endpoint },
    ]) {
      expect(bootstrapTelemetry(env)).toBeNull();
      expect(activeTelemetry()).toBeNull();
    }
    // A disabled boot says nothing: silence is part of the contract.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops a switched-on pipeline with no collector and says so once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(bootstrapTelemetry({ NODE_ENV: "production", [TELEMETRY_ENV]: "on" })).toBeNull();
    expect(activeTelemetry()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("FACILIS_TELEMETRY_ENDPOINT");

    warn.mockRestore();
  });
});
