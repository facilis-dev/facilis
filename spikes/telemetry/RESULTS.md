# Findings — ingestion route + FE→BE trace correlation (issues #133, epic #131)

Evidence: `results/report.json` (19/19 checks, one trace with three spans) and
`results/browser.png`. Reproduce with `node run.mjs`.

## What worked

- **The §8.8 gate chain holds in this order**: origin (`403`) → rate limit (`429` +
  `retry-after`) → body cap (`413`) → OTLP schema/batch (`400`) → scrub → dedup → forward.
  Rate limiting charged one token pre-parse and one per span post-parse, so a flood is stopped
  before its body is read and a single huge batch cannot bypass the span/min cap.
- **Correlation works**: the browser fetch span (`HTTP GET`, exported through the ingestion route,
  `via=ingestion`) is the parent of the Nitro span `GET /api/items`, which is the parent of the
  DB span `SELECT items`; all three share one trace-id. Nitro's request/response runtime hooks
  are the right insertion point: `event.context.matchedRoute.route` gives the route template, and
  the response hook can rename the span to `<method> <template>` after routing.
- **Value-free attributes are enforceable**: the forwarded server spans carry exactly
  `http.request.method`, `http.response.status_code`, `http.route`, and the DB span
  `db.system`, `db.operation`, `db.table`. A probe span carrying `url.full`,
  `http.request.header.authorization`, `enduser.email`, `http.request.body` and a resource
  `user.id` reached the collector with none of them, its name collapsed to `GET /orders/:id`.

## Findings that change the implementation plan

**F1. The two SDK lines cannot share one dependency tree.** `@opentelemetry/sdk-trace-web` has no
3.x release (latest 2.12.1, peer `@opentelemetry/api <1.10.0`), while the node line this spike uses
(`sdk-trace`/`resources`/`core` 3.1.1, `sdk-node` 0.301.2) requires `api >=1.10.0`. A single
install aborts with ERESOLVE. The spike therefore installs the browser bundle from its own tree
(`client/`). The framework needs two build-time dependency surfaces (or wait for the web SDK 3.x),
not one shared catalog entry.

**F2. `TracerProvider.register()` no longer exists in 3.x.** Registration is now
`trace.setGlobalTracerProvider(provider)` plus an explicit global context manager
(`AsyncLocalStorageContextManager`) and propagator (`CompositePropagator` with
`W3CTraceContextPropagator`); the 2.x convenience API is gone. `NodeSDK` still does this for you.

**F3. `BatchSpanProcessor` changed constructor shape, silently.** 3.x takes one options object
(`new BatchSpanProcessor({ exporter, scheduledDelayMillis })`); the 2.x form
`(exporter, config)` leaves `_exporter` undefined and **drops every span without an error**
(the only symptom is a crash on shutdown flush). Any port of #135/#136 must use the options form
and assert a span actually reaches the collector, not just that the SDK started.

**F4. `NodeSDK` is expensive in a production bundle.** Importing it pulled every bundled
exporter (grpc, proto, prometheus, zipkin, logs, metrics): 1.61 MB total vs 302 KB with
`TracerProvider` + one OTLP/JSON exporter. Prefer the lower-level provider behind the D-203
adapter; the adapter is also where `nitro-opentelemetry` would slot in.

**F5. Nitro's built-in tracing is not a shortcut for D-203.** `tracingChannel: true` +
`experimental.tracingLogger` emits spans on `diagnostics_channel`, but it neither extracts
`traceparent` (no correlation with the browser) nor exports OTLP. The runtime hooks (or a bridge
from the `tracing:h3.request` channels) are required for D-203's correlation and export.

**F6. The browser fetch instrumentation still emits legacy semantic conventions.**
`instrumentation-fetch@0.217` sets `http.url`, `http.method`, `http.status_code`, `http.host`,
`http.scheme`, `http.user_agent`, `http.response_content_length` — not `url.full` /
`http.request.method` / `http.response.status_code`. A pure allowlist therefore (a) correctly
strips the full URL (which carried the query string), and (b) also strips the *useful* RED
attributes, leaving the browser span attribute-less (see `report.json`). The ingestion class (or
the FE config, via semconv stability opt-in) must map the legacy keys onto the framework
vocabulary before scrubbing, otherwise FE spans lose method/status at the source.

**F7. Real OTLP/JSON payloads break a strict int64 schema.** The browser serializer emits
`intValue` as a JSON **number** (e.g. `{"intValue":200}`) and includes `events`, `links`,
`flags`, `droppedAttributesCount` and `scope`. Accepting only string uint64 (proto3-JSON
canonical) answered `400` to a legitimate SDK export; the schema must accept both forms and
ignore unknown span fields.

**F8. Path collision: `/__facilis/*` is reserved for dev-only endpoints.** §8.5 keeps those
`404` in production, and §8.8 wants the prod-only ingestion route to answer `404` when disabled.
Mounting it under the same prefix makes "dev-only" and "prod-only infrastructure" ambiguous and
easy to break with a future blanket rule. Recommend a distinct prefix (e.g.
`/_facilis/telemetry/v1/traces`) when #137 fixes the path; the spike's path is a constant.

**F9. Same-origin export needs no CORS, but the alternative origin does.** Chrome sends
`Origin` on same-origin POST, so the allowlist gate doubles as CSRF-ish protection without any
preflight. A RUM origin distinct from the app would require `OPTIONS` handling, which §8.8's
"POST only" wording does not cover — decide it explicitly (or keep RUM same-origin).

## Notes for the children

- #134: the deploy option is the switch that must gate the route to `404`; the spike proves the
  route can be absent from one boot of the same build.
- #135/#136: use the options-form processor (F3), the lower-level provider (F4), and the Nitro
  hooks (F5). Correlate through `traceparent`; the DB span parents off the event-carried context.
- #137: the gate chain works as written; add semconv mapping (F6) and the int64 tolerance (F7),
  and settle the path prefix (F8).
- #138/#139: the browser SDK split (F1) and the legacy attribute names (F6) are the two risks
  that must be resolved before RUM ships.
