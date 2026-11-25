import { hex, probePayload, probeSpan } from "./otlp-fixtures.mjs";

const INGESTION_PATH = "/__facilis/telemetry/v1/traces";
const JSON_HEADERS = { "content-type": "application/json" };

export async function post(base, path, { body, origin } = {}) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...(origin === undefined ? {} : { origin }) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    json,
  };
}

const validSpan = (traceId = hex("1", 32), spanId = hex("2", 16)) => probeSpan({
  traceId,
  spanId,
  name: "GET /api/items",
  attributes: { "http.request.method": "GET", "http.route": "/api/items" },
});

/**
 * The gate probes of spec §8.8. Order matters: the scrub/dedup/forward probes run before the
 * rate-limit flood, which exhausts the bucket for its window.
 */
export async function runGateProbes(context) {
  const { origin, enabledBase, disabledBase, collectorBase, spansPerMinute } = context;
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

  const wrongOrigin = await post(enabledBase, INGESTION_PATH, {
    body: probePayload([validSpan()]),
    origin: "http://evil.example",
  });
  check(
    "origin_wrong_rejected",
    wrongOrigin.status === 403 && wrongOrigin.json?.code === "origin_rejected",
    wrongOrigin.status + " " + (wrongOrigin.json?.code ?? ""),
  );

  const nullOrigin = await post(enabledBase, INGESTION_PATH, {
    body: probePayload([validSpan()]),
    origin: "null",
  });
  check("origin_null_rejected", nullOrigin.status === 403, String(nullOrigin.status));

  const missingOrigin = await post(enabledBase, INGESTION_PATH, {
    body: probePayload([validSpan()]),
  });
  check("origin_missing_rejected", missingOrigin.status === 403, String(missingOrigin.status));

  const malformed = await post(enabledBase, INGESTION_PATH, { body: "{not json", origin });
  check(
    "malformed_json_rejected",
    malformed.status === 400 && malformed.json?.code === "invalid_json",
    malformed.status + " " + (malformed.json?.code ?? ""),
  );

  const badSchema = await post(enabledBase, INGESTION_PATH, {
    body: { resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "zz" }] }] }] },
    origin,
  });
  check(
    "otlp_schema_rejected",
    badSchema.status === 400 && badSchema.json?.code === "invalid_otlp",
    badSchema.status + " " + (badSchema.json?.code ?? ""),
  );

  const oversized = await post(enabledBase, INGESTION_PATH, {
    body: JSON.stringify({ padding: "x".repeat(1024 * 1024 + 64) }),
    origin,
  });
  check(
    "body_cap_rejected",
    oversized.status === 413 && oversized.json?.code === "payload_too_large",
    oversized.status + " " + (oversized.json?.code ?? ""),
  );

  const tooMany = await post(enabledBase, INGESTION_PATH, {
    body: probePayload(
      Array.from({ length: 257 }, (_, index) =>
        probeSpan({
          traceId: hex("3", 32),
          spanId: index.toString(16).padStart(16, "0"),
          name: "GET /api/items",
        }),
      ),
    ),
    origin,
  });
  check(
    "batch_cap_rejected",
    tooMany.status === 400 && tooMany.json?.code === "batch_too_large",
    tooMany.status + " " + (tooMany.json?.code ?? ""),
  );

  const scrubTraceId = hex("c", 32);
  const scrubSpanId = hex("d", 16);
  const scrubResponse = await post(enabledBase, INGESTION_PATH, {
    origin,
    body: probePayload(
      [
        probeSpan({
          traceId: scrubTraceId,
          spanId: scrubSpanId,
          name: "GET /orders/4242?token=secret&email=a@b.c",
          attributes: {
            "url.full": "https://app.example/orders/4242?token=secret",
            "http.request.header.authorization": "Bearer test-token",
            "enduser.email": "a@b.c",
            "http.request.body": '{"card":"4111"}',
            "http.route": "/orders/:id",
            "http.request.method": "GET",
            "db.table": "orders",
          },
        }),
      ],
      { "service.name": "probe-client", "user.id": "u-42", "deployment.environment.name": "production" },
    ),
  });
  const collected = await (await fetch(collectorBase + "/spans")).json();
  const scrubbed = collected.spans.find((span) => span.spanId === scrubSpanId);
  const allowedKeys = new Set(["http.route", "http.request.method", "db.table"]);
  const survivedForbidden = scrubbed
    ? Object.keys(scrubbed.attributes).filter((key) => !allowedKeys.has(key))
    : ["<span missing>"];
  check(
    "scrub_strips_values",
    scrubResponse.status === 200 &&
      scrubbed !== undefined &&
      survivedForbidden.length === 0 &&
      scrubbed.resourceAttributes["user.id"] === undefined &&
      scrubbed.name === "GET /orders/:id",
    scrubResponse.status +
      " attrs=" +
      (scrubbed ? Object.keys(scrubbed.attributes).join(",") : "none") +
      " name=" +
      (scrubbed?.name ?? "none"),
  );

  const replay = await post(enabledBase, INGESTION_PATH, {
    origin,
    body: probePayload(
      [
        probeSpan({
          traceId: scrubTraceId,
          spanId: scrubSpanId,
          name: "GET /orders/4242?token=secret",
          attributes: { "http.route": "/orders/:id" },
        }),
      ],
    ),
  });
  const afterReplay = await (await fetch(collectorBase + "/spans")).json();
  const duplicates = afterReplay.spans.filter((span) => span.spanId === scrubSpanId).length;
  check(
    "span_dedup",
    replay.status === 200 && Number(replay.json?.partialSuccess?.rejectedSpans) === 1 && duplicates === 1,
    "status=" + replay.status + " rejected=" + replay.json?.partialSuccess?.rejectedSpans + " stored=" + duplicates,
  );

  const unknownPath = await post(enabledBase, "/__facilis/telemetry/v1/logs", {
    body: probePayload([validSpan()]),
    origin,
  });
  check("unknown_path_404", unknownPath.status === 404, String(unknownPath.status));

  const getIngestion = await fetch(enabledBase + INGESTION_PATH, { headers: { origin } });
  check(
    "method_not_allowed_absent",
    getIngestion.status === 404 || getIngestion.status === 405,
    String(getIngestion.status),
  );

  const disabled = await post(disabledBase, INGESTION_PATH, {
    body: probePayload([validSpan()]),
    origin,
  });
  check(
    "disabled_is_404",
    disabled.status === 404 && disabled.json?.code === "not_found",
    disabled.status + " " + (disabled.json?.code ?? ""),
  );

  let rateLimited = null;
  for (let attempt = 0; attempt < spansPerMinute + 30 && rateLimited === null; attempt += 1) {
    const response = await post(enabledBase, INGESTION_PATH, {
      origin,
      body: probePayload([
        probeSpan({
          traceId: hex("e", 32),
          spanId: attempt.toString(16).padStart(16, "0"),
          name: "GET /api/items",
        }),
      ]),
    });
    if (response.status === 429) {
      rateLimited = response;
    }
  }
  check(
    "rate_limit_429",
    rateLimited !== null &&
      Number(rateLimited.headers["retry-after"]) >= 1,
    rateLimited === null
      ? "never limited"
      : "retry-after=" + rateLimited.headers["retry-after"] + " code=" + rateLimited.json?.code,
  );

  return checks;
}
