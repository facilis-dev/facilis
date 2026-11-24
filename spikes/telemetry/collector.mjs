#!/usr/bin/env node
/**
 * Operator-owned OTLP/HTTP (JSON) collector for the spike — the "backend" D-203 assumes the
 * operator runs. It is deliberately dumb: accept, flatten, expose for assertions.
 *
 *   POST /v1/traces   ingest (application/json)
 *   GET  /spans       all received spans (JSON)
 *   POST /reset       drop spans
 *   GET  /health      { ok: true }
 */
import http from "node:http";

const PORT = Number(process.env.COLLECTOR_PORT || 4318);
const MAX_BODY = 4 * 1024 * 1024;
const spans = [];

const anyValue = (value) => {
  if (value === null || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("boolValue" in value) return value.boolValue;
  if ("intValue" in value) return Number(value.intValue);
  if ("doubleValue" in value) return value.doubleValue;
  return value;
};

function flatten(payload, via) {
  const received = [];
  for (const resourceSpan of payload.resourceSpans ?? []) {
    const resource = Object.fromEntries(
      (resourceSpan.resource?.attributes ?? []).map((attribute) => [
        attribute.key,
        anyValue(attribute.value),
      ]),
    );
    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        received.push({
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId ?? null,
          name: span.name,
          kind: span.kind ?? null,
          serviceName: resource["service.name"] ?? null,
          resourceAttributes: resource,
          attributes: Object.fromEntries(
            (span.attributes ?? []).map((attribute) => [attribute.key, anyValue(attribute.value)]),
          ),
          startTimeUnixNano: span.startTimeUnixNano,
          endTimeUnixNano: span.endTimeUnixNano,
          status: span.status ?? null,
          via,
        });
      }
    }
  }
  return received;
}

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://collector.invalid");
  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, { ok: true, spans: spans.length });
    return;
  }
  if (request.method === "GET" && url.pathname === "/spans") {
    const traceId = url.searchParams.get("traceId");
    json(response, 200, { spans: traceId ? spans.filter((span) => span.traceId === traceId) : spans });
    return;
  }
  if (request.method === "POST" && url.pathname === "/reset") {
    spans.length = 0;
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/traces") {
    let text;
    try {
      text = await readBody(request);
    } catch {
      json(response, 413, { error: "body too large" });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      json(response, 400, { error: "invalid json" });
      return;
    }
    spans.push(...flatten(payload, request.headers["x-spike-source"] ?? "unknown"));
    json(response, 200, { partialSuccess: {} });
    return;
  }
  json(response, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("[collector] listening on http://127.0.0.1:" + PORT);
});
