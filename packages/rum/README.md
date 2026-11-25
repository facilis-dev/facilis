# @facilis.dev/rum

Framework-owned browser RUM for Facilis apps (issue #138, D-203 §2, D-208).

- Emits Core Web Vitals (LCP/INP/CLS/FCP/TTFB) as `browser.web_vital` spans, window and
  React-boundary errors as `browser.error` spans (type + source only, never message/stack),
  plus document-load and fetch/XHR spans.
- Exports OTLP/JSON to the app's own ingestion route
  (`POST /__facilis/telemetry/v1/traces`) with the public write-only tenant key header.
- `traceparent` propagates to the app's own origin only, never third parties.
- URLs are scrubbed client-side (defense in depth; the server allowlist is the gate).
- Operator collector guidance, privacy hardening and consent: `docs/TELEMETRY.md` (D-209).
- Production-only and opt-in: the `facilisRum()` Vite companion injects the
  `__FACILIS_RUM_CONFIG__` literal at build time. Dev/disabled builds are completely silent.

`bootRum()` is called first in the framework template entry. The optional `./react`
subpath ships `RumErrorBoundary` (report-only; the fallback is caller-provided).

The web OTel line (sdk-trace-web 2.x, api 1.9.0) is deliberately separate from the server
line (SDK 3.x, api 1.10.0): the two cannot share one dependency tree (spike finding F1).

## Trace correlation, orphan spans, cross-origin (D-203 §4)

Every API fetch to the app's own origin carries a W3C `traceparent` header; Nitro continues
that trace and the DB query spans parent off the request, so one trace-id spans
browser fetch → Nitro request → DB query. The sampled bit (trace-flags) travels with the
header and both sides honor it (parent-based sampling). The integration gate is
`packages/nitro/src/runtime/telemetry/trace-correlation.test.ts`.

**Orphan spans.** The browser and the server export independently, and the RUM export never
retries (D-208). When an ad-blocker blocks the ingestion endpoint
(`POST /__facilis/telemetry/v1/traces`) or the backend is unreachable, traces arrive partial:

- The browser span still carries its client-generated trace-id even when the request failed or
  its export was blocked; there is simply no backend counterpart at the collector.
- Conversely, backend spans can arrive without the browser half when only the export path is
  blocked. The API request itself is never affected by a blocked export.

This is expected behavior, not data loss: read a missing half as a blocked export path. The
trace-id and the sampling decision stay consistent on whichever half survives, and the export
request itself is never instrumented (it cannot feed itself).

**Cross-origin deployments.** Same-origin (the default: one Nitro deployment serves SPA and
API) needs no CORS setup. When the API lives on a different origin, two things must hold:

1. The API's `Access-Control-Allow-Headers` must include `traceparent`, or the browser
   strips the header on the cross-origin request and the trace splits. The framework's CORS
   preflight echoes the requested headers for allowed routes; an operator proxy in front of
   the app must allow the header as well.
2. The propagation allow-list must cover the API origin: `traceparent` is injected only into
   requests matching it (never third parties).
