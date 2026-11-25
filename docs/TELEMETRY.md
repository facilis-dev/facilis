# Production telemetry — operator guide

Facilis apps emit OpenTelemetry (D-203): backend request/DB/job spans and frontend RUM
(web vitals, errors, document-load/fetch timings). **Push-only, operator-owned: Facilis
hosts nothing and receives nothing.** You run the collector and the backend; the app only
exports to them. This guide covers collector setup, privacy hardening, data minimization
and the consent position. The deploy options themselves are documented in
[MANAGED-DEPLOYMENT.md](./MANAGED-DEPLOYMENT.md) §3; the contract is spec §6.10 and §8.8.

Telemetry is **off by default** and enabled only through build-time deploy options
(`telemetry.enabled`, D-063/D-064). There is no runtime policy switch. In dev and inside
the WebContainer no telemetry leaves the machine (D-200).

## 1. Architecture

```text
browser RUM ──POST /__facilis/telemetry/v1/traces──▶ app ingestion route ──OTLP/HTTP──▶ your collector ──▶ your backend
backend spans (Nitro/DB/jobs) ─────────────────────────────OTLP/HTTP────────────────▶ your collector ──▶ your backend
```

- The **ingestion route** is framework infrastructure, not user-authorable: write-only
  `POST`, `404` whenever telemetry is disabled or the environment is not production.
  The browser carries only a **public write-only tenant key**; the collector credential
  stays server-side. Gates, in order: exact origin allowlist → tenant key → rate limit
  (before the body is read) → 1 MiB body cap → OTLP schema → 256-span batch cap →
  attribute scrub → span-id dedup → forward.
- The browser exports **same-origin** to the app, and the app forwards server-side. The
  forwarder sends only the scrubbed OTLP payload: no browser credential, no end-user IP.
  Your collector therefore sees the **app's egress IP**, not your users' addresses.
- W3C `traceparent` correlates a browser fetch with the backend span that serves it;
  propagation is restricted to the app's own API origin.

## 2. RUM ≠ audit

**Real-user monitoring is observational, not an audit trail.** RUM input is spoofable and
noisy by nature (an allowed origin can flood the route through XSS), it is sampled, and
ad-blockers or closed tabs drop events. Never use telemetry for security decisions,
accounting, or compliance evidence.

The **D-119 audit pipeline stays separate and intact**: access/error/audit/app entries are
server-side JSONL with redaction, caps and a tamper-evidence hash chain, written on every
authorized-handler exit path. Telemetry never reads from it, never writes to it, and does
not change it. See [LOGS.md](./LOGS.md).

## 3. What is emitted — and what never is

The attribute vocabulary is framework-controlled and derived from declarations
(`packages/nitro/src/runtime/telemetry/vocabulary.ts`):

| Attribute | Source |
|---|---|
| `http.request.method`, `http.route`, `http.response.status_code` | request metadata; route **template**, never the concrete path |
| `db.system.name`, `db.operation.name`, `db.collection.name` | the query descriptor; table names from `dbTables` |
| `facilis.job.name`, `facilis.job.attempt` | job declaration |
| `facilis.workflow.name`, `facilis.workflow.step`, `facilis.workflow.step.kind` | workflow declaration |
| `browser.web_vital.name`, `browser.web_vital.value`, `browser.web_vital.rating` | pinned web-vitals triple (LCP/INP/CLS/FCP/TTFB) |
| `error.type`, `facilis.rum.source` | error **constructor type** and source — never a message, stack or reason |
| `service.name`, `deployment.id`, `deployment.environment.name`, `telemetry.sdk.*` | resource identity |

**Never emitted:** values, query strings, fragments, bodies, headers, cookies, user ids,
session ids, error messages/stacks, console output, breadcrumbs, persistent client
identifiers. URLs are reduced to templated pathnames client-side; UUID, numeric and
email-shaped path segments collapse to `:id`; the ingestion allowlist is the final gate
and drops everything else, including span events, links and status messages.

## 4. Collector setup

Run any OTLP/HTTP-capable collector. Two reference configs ship in this repository,
both implementing §5's hardening; their allowlists are gated against the vocabulary by
`packages/nitro/src/runtime/telemetry/collector-config.test.ts` (drift fails `pnpm test`):

- **Grafana Alloy**: [`telemetry/alloy.river`](./telemetry/alloy.river)
- **Generic OpenTelemetry Collector** (otelcol-contrib): [`telemetry/otelcol.yaml`](./telemetry/otelcol.yaml)

Setup:

1. Deploy the collector with the reference config; check it
   (`otelcol-contrib validate --config otelcol.yaml`, or Alloy's UI/validate).
2. Point the app at the collector: deploy option `telemetry.exporterEndpoint` (backend
   export) — the frontend always exports through the app's own ingestion route, which
   forwards to the same endpoint (`FACILIS_TELEMETRY_ENDPOINT` at runtime).
3. Point the collector's exporter at **your backend**: Grafana Tempo/Mimir/Loki, Grafana
   Cloud, Elastic, Honeycomb, or any OTLP backend. The backend credential lives in the
   collector's environment (e.g. `COLLECTOR_BACKEND_TOKEN`), never in the app or browser.
4. Set `telemetry.tenantKey` (public write-only key the browser sends to the ingestion
   route) and, for cross-origin frontends, the exact `telemetry.originAllowlist`.
5. Optional: `telemetry.dashboardUrl` adds an IDE **link-out** to your dashboard (v1: no
   query, no telemetry token, no remote feed into the IDE). Managed CSP must allow it in
   `connect-src` (MANAGED-DEPLOYMENT §3).

## 5. Privacy hardening at the collector

The app-side scrub is the first gate; the collector is **defense in depth** (D-203 §7).
Keep both reference-config rules even though Facilis payloads are already scrubbed:

- **Redaction allowlist (fail-closed).** `allow_all_keys: false` with exactly the
  framework vocabulary (plus the legacy semconv aliases a browser SDK may emit on a direct
  export). Everything else — raw URLs, query strings, headers, bodies, PII-bearing keys —
  is dropped. Resource attributes are kept to the same closed set. If you extend the
  vocabulary, extend the config in the same change; the drift test enforces it.
- **IP truncation.** IPv4 keeps the /24 prefix, IPv6 the /48. Facilis forwards server-side
  and never sends the end-user IP, so in the default topology there is nothing to truncate;
  the rules cover a `client.address` attribute injected by your own proxy/gateway or
  arriving from other OTLP sources. Truncated IPs reduce but do not eliminate the
  obligations in §7.
- **Retention and access.** Keep trace retention short (§6), restrict backend access to
  operators who need it, and never join telemetry with user-identifying data sets.

## 6. Data minimization

- **Sample.** `telemetry.sampling` (0..1, default 1) is head sampling: the decision is
  made at the trace root and propagated, so a sampled-out trace emits nothing anywhere.
  Start below 1 for high-traffic apps; errors and vitals are spans too and are sampled
  with the rest.
- **Aggregate, don't enumerate.** Dashboards should aggregate by route template, method
  and status — the vocabulary is low-cardinality by construction. Do not build per-user
  views; there is no user dimension to build them from.
- **Short retention.** Operational telemetry ages fast: days, not months. Set the
  backend's retention accordingly and document it in your privacy notice.
- **Rate limits are a privacy control too.** The ingestion route defaults to 24 spans per
  minute per origin|IP|tenant (`FACILIS_TELEMETRY_SPANS_PER_MIN`), blunting floods and
  replay; span-id dedup drops replays. Keep the defaults unless you have a measured need.
- **No secondary use.** Telemetry exists to operate the app (latency, errors, vitals).
  Using it for profiling, advertising or cross-site tracking changes the lawful basis and
  the consent answer (§7) — do not do it silently.

## 7. Consent and lawful basis (D-210)

**The operator is the data controller.** Facilis hosts nothing and receives nothing, so it
is not a processor. Before enabling telemetry:

- Assess the lawful basis (GDPR Art. 6). Legitimate interest is arguable for minimal,
  value-free operational telemetry, but the balancing test, transparency (Arts. 13–14)
  and any DPIA (Art. 35) are yours. Where national law or your policy requires consent,
  obtain it **before** enabling telemetry.
- ePrivacy Art. 5(3) (terminal-equipment storage/access): Facilis RUM sets no cookie and
  stores no persistent identifier, so the framework itself does not trigger it. Combining
  telemetry with other trackers inherits their consent duties.
- IP addresses are personal data even when truncated; the default topology never sends
  end-user IPs to the collector (§1), and the reference configs truncate any that arrive
  by other paths (§5).

**v1 ships no framework consent gate** (D-210): telemetry is off by default and opt-in at
build time; a runtime consent UX is app-specific and deferred. If your assessment requires
consent before any telemetry, keep telemetry disabled until your own consent flow allows
enabling it in a build.

## 8. Verification

- `pnpm test` runs the scrub suites (`packages/rum/src/scrub.test.ts`,
  `packages/nitro/src/runtime/telemetry/ingest/scrub.test.ts`) and the collector-config
  drift gate (`collector-config.test.ts`).
- The ingestion gates (origin, tenant key, rate limit, caps, schema, scrub, dedup) are
  covered by `packages/nitro/src/runtime/telemetry/ingest/*.test.ts` and the route test.
- D-119's redaction pipeline has its own suite (`runtime/logging/redact.test.ts`) and is
  untouched by telemetry.
