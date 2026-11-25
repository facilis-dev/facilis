# Spike — framework ingestion route + FE→BE trace correlation (issue #133)

Throwaway feasibility spike for epic #131 (D-203). It is **not** a workspace member and is
never imported by a package; retire it once the findings in [RESULTS.md](./RESULTS.md) are
absorbed by the epic (D-006).

## What it proves

1. A framework-mounted, write-only OTLP/HTTP ingestion route works as the spec §8.8 route class:
   strict origin allowlist, token-bucket rate limit (span/min) evaluated before the body is read,
   1 MiB body cap (declared and streamed), OTLP schema + batch validation, attribute allowlist
   scrub (values/PII stripped), span-id dedup, and forwarding to the operator's collector.
   Disabled telemetry is `404` (not 401/403), and the route has no read surface.
2. One W3C trace-id joins browser `fetch` → Nitro request → DB query, with the server span a child
   of the browser span (`traceparent` injected by `sdk-trace-web` fetch instrumentation, extracted
   by Nitro request hooks) and the DB span a child of the request span.

`node run.mjs` runs 19 assertions end to end and exits non-zero on any failure.

## Layout

```
server/                     Nitro app (production build, one route class + one app route)
  plugins/telemetry.ts      OTel provider + Nitro request/response hooks (traceparent extraction)
  lib/telemetry/            config, OTLP/JSON exporter, event-carried trace context, route template
  lib/ingest/               the gates: origin, rate limit, body cap, schema, scrub, dedup, forward
  lib/db.ts                 node:sqlite with a declared-table DB span
  routes/api/items.get.ts   instrumented app route
  routes/__facilis/telemetry/v1/traces.post.ts   the framework ingestion route
client/                     browser side (separate install tree, see RESULTS.md F1)
collector.mjs               operator-style OTLP/JSON collector used for assertions
run.mjs, lib/               runner + gate probes
results/                    committed evidence: report.json (trace + checks), browser.png
```

## Run

```sh
npm install                 # server deps (Nitro + node OTel 3.x line)
npm --prefix client install # browser deps (sdk-trace-web 2.x line)
node run.mjs                # builds client + nitro, boots 3 processes + Chrome, asserts
```

Needs the browser artifacts from `pnpm ide:browser` (`docs/DEV.md`): set
`FACILIS_TOOLING_DIR` (default `/tmp/facilis-dev`) or `FACILIS_CHROME`. Ports 5180 (telemetry
on), 5182 (telemetry off) and 4318 (collector). Artifacts: `results/report.json`,
`results/browser.png`, logs in `.spike/`.

## Mapping to spec §8.8

| Contract clause | Implementation | Assertion |
| --- | --- | --- |
| strict origin allowlist, `null` rejected | `lib/ingest/origin.ts` | `origin_wrong_rejected`, `origin_null_rejected`, `origin_missing_rejected` |
| rate limit before body parse, 429 + retry-after | `lib/ingest/rate-limit.ts` (charged pre-parse and per span) | `rate_limit_429` |
| 1 MiB cap (content-length + streamed) | `lib/ingest/body.ts` | `body_cap_rejected` |
| OTLP schema + max spans/batch | `lib/ingest/schema.ts` | `otlp_schema_rejected`, `batch_cap_rejected` |
| attribute allowlist / scrub | `lib/ingest/scrub.ts` | `scrub_strips_values`, `span_attributes_value_free` |
| span-id dedup | `lib/ingest/dedup.ts` | `span_dedup` |
| write-only, no read surface | route is `.post.ts`, `404` otherwise | `method_not_allowed_absent`, `unknown_path_404` |
| disabled means absent | boot switch (env) on the same build | `disabled_is_404` |
| FE↔BE trace context | `sdk-trace-web` fetch instrumentation + Nitro hooks | `single_trace_id`, `server_parent_is_fetch`, `db_parent_is_request`, `fe_span_exported` |

## Deliberate stand-ins

- `defineAuthorizedHandler` / `dbTables` are out of scope for a spike: the app route is a plain
  Nitro handler and the DB layer declares its table locally. Invariant 1 is not exercised here.
- "Build-time deploy option" (D-203 §5) is approximated by a boot-time env switch so one build
  can be booted both ways; the 404-before-origin ordering is what the spike proves.
- Only OTLP/JSON is exercised (the browser SDK ships JSON); protobuf transport is not.
- The page is served from the same origin as the API, so no CORS preflight exists in the flow;
  a separate RUM origin would need `OPTIONS` handling that §8.8 does not specify.
