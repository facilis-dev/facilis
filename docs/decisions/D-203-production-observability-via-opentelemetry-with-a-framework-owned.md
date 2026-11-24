# D-203 — Production observability via OpenTelemetry with a framework-owned ingestion endpoint
**Status:** accepted (2026-11-21)

**Context.** The IDE graph and its statistics are static AST facts plus dev-only local data
(`ProjectGraphPanel`, `DataExplorerPanel`, the dormant runtime-metrics buffer of D-200). Users want
real production observability — backend RED metrics and frontend errors/timings — without exposing
application data. An earlier analysis rejected any production *data* API surface as too risky.
OpenTelemetry (OTel) is the chosen direction: push-only, operator-owned backend, value-free
attributes, no inbound data surface on the app.

Facilis is low-code: a generated-app user cannot run a separate reverse proxy. The telemetry
ingestion point must therefore be **framework infrastructure embedded in the app**, in the same
spirit as the storage upload/download routes (`packages/nitro/src/storage.ts`, signed download
tokens, `FACILIS_STORAGE_SECRET`) — provided by the framework, **not user-authorable**, and
toggleable through deploy options.

This touches invariant 1 (a new route class that cannot use `defineAuthorizedHandler` because a
browser holds no session), invariant 6 (dev-only endpoints stay 404 in production — this is a
*separate*, prod-only infrastructure route), D-200 (dev metrics stay local), D-119 (the audit
pipeline stays separate), and D-063/D-064 (build-time deploy config and managed CSP). The
epic/child bodies say "D-202 (accepted)"; that is stale — the draft carrying that ID was never
landed, and D-202 was taken by the prerendering decision on 2026-11-23, so this decision takes
the next free ID, **D-203**, and every "D-202" reference in epic #131 and issues #132–#141 means
this entry.

**Decision.** Proposed design — what would be implemented. Accepted 2026-11-21 with one amendment: IDE consumption in v1 is **link-out only** (the read-only
backend-query mode is deferred). It remains a contract change requiring a spec §8 amendment before
implementation.

1. **Framework-owned backend instrumentation.** Nitro request spans created via runtime hooks,
   extracting the incoming W3C `traceparent` so a server span continues the browser trace.
   The attribute vocabulary is framework-controlled and derived from declarations: route template
   (from the manifest), method, status, duration, table names (from `dbTables`) — **never values,
   query strings, bodies, or headers**. DB spans at driver level (production is Postgres, D-068);
   custom spans for jobs/workflows. Built on OTel JS SDK 3.x (min Node >=22.15.0, already the
   Facilis floor; dual ESM/CJS exports; traces/metrics/logs all stable). The community
   `nitro-opentelemetry` module is isolated behind an adapter; an official built-in Nitro OTel
   integration is announced and should be preferred when it lands. Off by default.

2. **Framework-owned frontend (RUM) instrumentation.** `@opentelemetry/sdk-trace-web` +
   `context-zone` (ZoneContextManager), `instrumentation-document-load`, fetch/XHR, and
   web-vitals mapped to the `browser.web_vital` semantic convention (LCP/INP/CLS/FCP/TTFB; that
   semconv is still *Development*, so pin/adapter it). Errors via `window.onerror`,
   `unhandledrejection`, and the React error boundary. `propagateTraceHeaderCorsUrls` restricted
   to the app's own API origin (never third parties). URLs scrubbed to route templates; no PII, no
   console/breadcrumbs by default. React user-interaction spans are deferred (hydration/event-
   delegation fragility). Prod-only, opt-in.

3. **The ingestion endpoint as a new infrastructure route class.** A framework-mounted,
   **not user-authorable** route (path TBD, e.g. under `/__facilis/`), analogous to storage
   download. Ingestion-only: accepts `POST` OTLP/HTTP, **write-only**, no read/query surface;
   404/405 on anything else, and **404 when telemetry is disabled** in deploy config. Hardening:
   - strict origin allowlist (scheme+host+port, reject `"null"`, no wildcard);
   - rate limit per origin/IP/tenant (token bucket, span/min cap, drop excess);
   - body cap (1 MiB, as `defineAuthorizedHandler`), OTLP schema validation, max spans per batch;
   - attribute allowlist/redaction (framework vocabulary only; strip raw URLs/query/body/headers/input);
   - span-id dedup to blunt replay; head sampling at the SDK, tail sampling at the collector.
   The real collector credential stays **server-side** at this endpoint; the browser carries only a
   **public write-only tenant key** plus the endpoint URL. The endpoint forwards OTLP to the
   operator's collector/backend. Because a browser holds no session, this is a deliberate,
   spec-defined exception to invariant 1: a **"public infrastructure ingestion"** route class whose
   gates are origin + rate limit + schema validation instead of auth. It is structural (framework
   emits it), never generated from user DSL, and never enabled by default.

4. **FE↔BE trace correlation.** W3C Trace Context (`traceparent`/`tracestate`) on the **API
   request path**: the browser fetch instrumentation injects it, Nitro extracts it, both record
   spans under one trace-id, and the backend stitches them. The ingestion endpoint is a dumb pipe
   and does **no** correlation. Parent-based sampling propagates the decision via the trace-flags.
   SPA and API are typically same-origin (one Nitro deployment), so the CORS `Allow-Headers`
   gotcha for `traceparent` does not arise; cross-origin deployments must allow the header.

5. **Deploy options (build-time, D-063/D-064).** `facilis.deploy.json` / config gains: telemetry
   enabled (default **off**), separate BE and FE toggles, exporter endpoint (operator collector),
   public tenant key, sampling rate, origin allowlist. Managed CSP: the ingestion route is
   same-origin (already the app origin); the operator backend host is declared in `connect-src`
   only if the IDE queries it. Open profile is more permissive. No runtime policy switch.

6. **IDE consumption — v1 is link-out only.** The IDE opens the operator's observability
   dashboard in an external tab, driven by a deploy-option URL, per project. **No backend query, no
   telemetry token, no remote feed into the IDE in v1** — zero connection, zero credential, zero
   app-data surface. The read-only backend-query mode (a scoped telemetry token feeding the
   transport-agnostic `RouteRingBuffer` in `ide/src/facilis/runtime-metrics-buffer.ts` to light the
   graph runtime lens #72 with production data) is **deferred** to a later iteration; the dev-local
   runtime lens (#72, epic #56, D-200) is unaffected.

7. **Privacy and security posture.** Data minimization; scrub to route templates; IP truncation and
   a redaction allowlist at the collector. RUM is **spoofable and noisy by nature** (a public
   write-only endpoint can be flooded from an allowed origin via XSS) — it is observational, **not
   an audit trail** and not a security boundary; the D-119 audit pipeline stays separate and
   intact. GDPR/ePrivacy: a consent gate may be required per deployment; anonymized attributes,
   no persistent identifiers, and truncated IPs reduce but do not eliminate the obligation.
   **Dev is unchanged** (D-200): inside the WebContainer/preview no telemetry leaves the machine;
   local dev metrics remain the dev story.

**Consequences.**
- A new structural route class and a spec §8 amendment are required; invariant 1 gains a named,
  framework-only exception. Invariant 6 is preserved: dev-only endpoints are untouched and still
  404 in production.
- D-200 is *extended*, not weakened: production telemetry is opt-in and operator-owned; dev stays
  local. D-119 is unchanged. D-063/D-064 deploy schema grows.
- The operator must run a collector + backend (or a managed service); **Facilis hosts nothing and
  receives nothing**. The attribute vocabulary is framework-controlled, so telemetry is value-free
  by construction.
- The browser-events semconv is still Development → pin/adapter. React interaction spans deferred.
- Cost: collection infrastructure and attribute/consent discipline. Gain: real production
  observability (BE + FE) with no application-data exposure and no user-managed proxy.

**Open questions.**
- Backend/gateway choice (Grafana Alloy/Faro vs Elastic EDOT vs generic OTLP collector) and whether
  the FE export shares the ingestion route or uses a separate one.
- Exact route path and the name/shape of the "public infrastructure ingestion" route class.
- Default sampling rates; whether a consent gate ships in v1.
- Whether to wait for the official Nitro OTel integration or ship the adapter first.

**Verification (when accepted).** Per spec §12, prove the risky assumption with a runnable spike in
`spikes/` (never shipped): framework instrumentation + ingestion route + a FE→BE correlated trace.
Unit tests for origin/rate-limit/schema/scrub on the ingestion route; an integration test asserting
one trace-id spans browser fetch → Nitro → DB; `pnpm ide:smoke` for the graph runtime lens. Full
Definition of done: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, plus the spec §8
amendment and this decision moved to *accepted*.
