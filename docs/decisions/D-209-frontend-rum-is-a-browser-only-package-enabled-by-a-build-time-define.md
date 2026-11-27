# D-209 — Frontend RUM is a browser-only package enabled by a build-time define
**Status:** accepted (2026-11-24); the build-time switch is renamed `FACILIS_TELEMETRY_ENABLED` by D-224

**Context.** D-203 §2 specified framework-owned frontend RUM (issue #138): web vitals, errors,
document-load and fetch spans, value-free attributes, own-origin `traceparent` propagation,
export through the §8.8 ingestion route. The telemetry spike
(`spikes/telemetry/RESULTS.md`) proved the browser SDK line but surfaced the constraints this
decision records: F1 (the web and node SDK lines cannot share one dependency tree), F3 (the
`BatchSpanProcessor` constructor shape differs silently between the lines), F6 (the 0.217
browser instrumentations still emit legacy semconv keys), F7 (real OTLP/JSON payloads carry
numeric int64 and extra fields) and F9 (same-origin export needs no CORS).

**Decision.**

1. **A browser-only package, `@facilis.dev/rum`.** The web OTel line (`sdk-trace-web` 2.12.1,
   `@opentelemetry/api` 1.9.0) conflicts with the server line (SDK 3.x, api 1.10.0) in one
   dependency surface (spike F1), so RUM ships as its own package with its own exact pins —
   generated apps install with npm, so no peer conflict may exist. The `./react` subpath
   (`RumErrorBoundary`) is optional; the core boot never imports react. On the 2.x line the
   spike-proven `(exporter, config)` processor form and `provider.register()` are used (F2/F3);
   the options-object form is the 3.x API and would silently drop every span here. The XHR
   instrumentation is `@opentelemetry/instrumentation-xml-http-request` 0.217.0 (the official
   package name) and document-load is 0.62.0, the release paired with instrumentation 0.217.0 —
   document-load never published a 0.217.0 and its later releases moved to the server line.
2. **Build-time delivery, no runtime switch.** The `facilisRum()` Vite companion
   (`apply: "build"`) reads `FACILIS_TELEMETRY` + `FACILIS_TELEMETRY_FE` + the tenant key env
   and injects the `__FACILIS_RUM_CONFIG__` define literal; disabled builds define it as null.
   The framework template entry calls `bootRum()` first. No inline HTML script (CSP/rolldown
   risk), no virtual module. FE is an explicit opt-in, off by default; dev/WebContainer is
   completely silent — no export, no instrumentation, no zone patching (D-200).
3. **The development-status semconv is pinned and adapted.** `browser.web_vital` is pinned to
   its `name`/`value`/`rating` triple and emitted as spans, because the ingestion class
   accepts spans only. Errors carry `error.type` (sanitized constructor name) and
   `facilis.rum.source` only — never message, stack, filename or reason values (PII). The
   standard web-vitals build is used, never attribution (element selectors are PII).
4. **Client-side scrub is defense in depth.** `@facilis.dev/rum` scrubs attributes to the
   server vocabulary plus the RUM names, reduces URL-bearing values to templated pathnames and
   caps span names; the server allowlist (§8.8) remains the final gate. The legacy keys the
   0.217 instrumentations emit (F6) are handled by the server's existing mapping, unchanged.
5. **Export posture.** OTLP/JSON to `POST /__facilis/telemetry/v1/traces` with the public
   write-only tenant key header, `keepalive`, a 3 s abort timeout, under `suppressTracing`.
   No retries: the server's span-id dedup rejects replays, and a failed export resolves silently
   — RUM must never break the app. Same-origin export needs no CORS (F9); the numeric int64
   tolerance the route already ships covers the browser serializer (F7).
6. **Operator sizing.** The default `FACILIS_TELEMETRY_SPANS_PER_MIN` (24/min) is backend-sized;
   an operator enabling FE should raise it, or legitimate vitals/fetch batches will be dropped
   with 429. The full collector guidance belongs to issue #141.

**Consequences.** Spec §6.10/§8.8 carry the RUM vocabulary; the ingestion gates are unchanged.
The templates declare `@facilis.dev/rum` and the IDE's scan-based vendoring/minimums pick it up
(the explicit `TEMPLATE_PACKAGES` parity list gains `rum`). Two clean OTel dependency surfaces
now coexist in the workspace; a future web SDK 3.x release can collapse them, and this decision
is the place to record that migration.
