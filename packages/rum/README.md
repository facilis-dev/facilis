# @facilis.dev/rum

Framework-owned browser RUM for Facilis apps (issue #138, D-203 §2, D-208).

- Emits Core Web Vitals (LCP/INP/CLS/FCP/TTFB) as `browser.web_vital` spans, window and
  React-boundary errors as `browser.error` spans (type + source only, never message/stack),
  plus document-load and fetch/XHR spans.
- Exports OTLP/JSON to the app's own ingestion route
  (`POST /__facilis/telemetry/v1/traces`) with the public write-only tenant key header.
- `traceparent` propagates to the app's own origin only, never third parties.
- URLs are scrubbed client-side (defense in depth; the server allowlist is the gate).
- Production-only and opt-in: the `facilisRum()` Vite companion injects the
  `__FACILIS_RUM_CONFIG__` literal at build time. Dev/disabled builds are completely silent.

`bootRum()` is called first in the framework template entry. The optional `./react`
subpath ships `RumErrorBoundary` (report-only; the fallback is caller-provided).

The web OTel line (sdk-trace-web 2.x, api 1.9.0) is deliberately separate from the server
line (SDK 3.x, api 1.10.0): the two cannot share one dependency tree (spike finding F1).
