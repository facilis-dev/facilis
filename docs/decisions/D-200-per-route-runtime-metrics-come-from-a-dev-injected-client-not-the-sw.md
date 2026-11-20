# D-200 — Per-route runtime metrics come from a dev-injected client, not the SW or an endpoint
**Status:** accepted (2026-11-20)

**Context.** The graph runtime lens (#72, epic #56) needs per-route facts — request count,
error rate, p50/p95 latency — for the project running in the WebContainer. Nothing emitted
them: `graph-live.ts` is a layout-change bus, the analyzer is static, and the IDE had no view
of the preview's requests. Issue #71 required a proven, dev-only source before any UI:
no telemetry leaving the machine, no production surface, no weakening of security
invariant 6, and no edit to `ide/public/sw.js` or `vendor/vivari` (D-132 sync). Three
options were spiked under `spikes/runtime-metrics/` (standalone, retired with this record):
(1) a dev-injected client in the generated app, (2) Service Worker counters, (3) a polled
dev HTTP endpoint.

**Decision.**

- **Option 1: a dev-only client injected by the framework Vite plugin.**
  `facilisDevMetrics()` (`packages/nitro/src/vite-dev-metrics.ts`) rides in `facilis()`
  with `apply: "serve"`: Vite drops it from `vite build` entirely, so a production
  artifact contains no client (grepped in a real build) and there is **no endpoint at
  all** — invariant 6 is untouched, not merely satisfied. `transformIndexHtml` injects
  the client (`dev-metrics-client.ts`, a dependency-free classic script) as the first
  `<head>` script, before the app's module scripts. Rollback: `FACILIS_DEV_METRICS=0`
  removes the injection without touching project code; the plugin is the only wiring.
- **Dormant until asked.** The injected client wraps nothing until the IDE posts an
  enable message; the IDE collector (`ide/src/facilis/runtime-metrics.ts`) is equally
  off by default. The future lens enables it; nothing else in the IDE knows it exists.
- **Message contract** (source tag `vv-metrics` both ways):
  - IDE → preview: `{ source: "vv-metrics", type: "enable", token: <kernel token>, routes: string[] }`
    and `{ source: "vv-metrics", type: "disable" }`.
  - preview → IDE: `{ source: "vv-metrics", type: "batch", token: <kernel token>, samples: [{ route, method, status, duration }] }`,
    flushed every second (or at 256 samples). `route` is a **template**
    (`/api/todos/{id}`), `method` an uppercase HTTP verb, `status` the HTTP status
    (0 = aborted/network failure), `duration` ms to **response headers** (streaming
    bodies are never read, so a stream passes through untouched). No query strings,
    bodies or headers ever enter a sample.
- **Token delivery.** The issue suggested `location.search`, but the preview SW records
  the kernel token and redirects it away *before the app loads* (D-132; the bridge's
  `sameOriginPreviewUrl` exists precisely so "the app never sees the token"). The IDE
  therefore extracts the current boot token from the bridge's own URL builder and hands
  it to the client in the enable message; every batch must echo it back. The client
  accepts control messages only when `event.source === window.parent`, so a sibling
  frame cannot forge an enable.
- **Validation (IDE receiver).** Origin first: the same trust rule the DevTools relay
  uses (mode A: the IDE origin; B/C: `bridge.isTrustedPreviewOrigin`). Then the full
  contract: source tag, `type: "batch"`, the **current** kernel token, a **64 KiB**
  cap on the UTF-8 JSON encoding (a worst legal batch — 256 samples of 128-char routes —
  is ~43 KiB, so the cap never truncates honest traffic but bounds hostile allocation),
  ≤ 256 samples, and per sample: route ≤ 128 chars starting `/` with no `?`/`#`,
  known uppercase method, integer status 0–599, finite duration in [0, 1 h]. One bad
  sample rejects the whole batch. Unit tests cover wrong/missing token, wrong origin,
  oversized payload, and each malformed field.
- **Route templates.** The enable message carries the template list; the caller (the
  future lens) derives it from the manifest/analyzer it already loads — the collector
  fetches nothing. Requests matching no template are **dropped**, not bucketed: they are
  assets, HMR and third parties, not project routes, and dropping them keeps concrete
  paths (and any IDs in them) out of the pipeline. The collector re-checks the list on
  ingest, so the client's matching is not trusted blindly.
- **Buffering.** Per route: a ring of **1000 samples** with a **5-minute** window
  (inclusive boundary), and p50/p95 from **15 latency buckets**
  ([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, ∞) ms), never
  from raw arrays: bucket/class counters are maintained incrementally on add, eviction
  and expiry. Percentile = nearest-rank, reported as the containing bucket's upper bound
  (a band, not false precision); the overflow bucket reports null. Aborted requests
  (status 0) count toward traffic but are excluded from latency. Errors = 5xx;
  clientErrors = 4xx, reported separately. At most 256 routes tracked.
- **The seam for #72.** `getRuntimeMetrics()`, `subscribeRuntimeMetrics()` /
  `notifyRuntimeMetrics()` (the `graph-live.ts` pattern), and
  `enableRuntimeMetrics(session, routes)` / `disableRuntimeMetrics()`
  (`runtime-metrics-wire.ts`). In dev builds `window.__facilis.runtimeMetrics`
  (`{ enable, disable, snapshot }`) exposes the same seam for the console and headless
  checks. No lens UI, mode logic or URL state here — those are #72 and its siblings.

**Rejected.** *Option 2 — SW counters*: the per-request work is cheap (measured
0.27 µs for token lookup + template match + Map increment), but it adds another IDE-side
patch to `ide/public/sw.js`, which must stay in sync with the read-only vendor submodule
on every upstream bump (D-132) — a recurring cost for a dev-only feature. The SW also
cannot see app-side aborts, loses counts on eviction, and timing handler duration would
mean wrapping `respondWith` — invasive for every preview request, not just metrics.
*Option 3 — polled dev endpoint*: a loopback roundtrip measured 0.055 ms vs 0.0089 ms for
the postMessage hop (batch serialization 0.012 ms), and it would add a new invariant-6
surface (production 404 + origin allowlist + tests), a poll loop, and cross-frame fetch
plumbing — more moving parts than option 1 for data that already rides an existing
channel. *Wrapping fetch invasively*: rejected by measurement, not argument — the spike
proved the wrapper transparent (below); had it altered streaming, aborts or workers it
would have fallen back to option 2.

**Spike numbers** (Node 26, loopback HTTP server, 40 paired rounds × 50 requests
[30×200, 8×404, 6×500, 4×20 ms, 2×streamed]; headless Chromium 156 for XHR/stream/abort):

| Measure | Baseline | With client | Overhead |
|---|---|---|---|
| CPU, total over 2000 requests | 816.76 ms | 823.62 ms | **+0.84 %** |
| Wall per 50-request round | 134.11 ms | 135.24 ms | +0.84 % |
| Mean added latency per request | 2.682 ms | 2.704 ms | **+0.023 ms (+0.84 %)** |
| Record path alone (100k iterations) | — | 0.62 µs/call | 0.17 % of baseline CPU/request |
| postMessage one-way (500 ping-pongs) | — | 0.0089 ms | — |

Per-round CPU deltas are noise-dominated (paired mean 0.17 ms ± 2.37 stderr); the total
over 40 rounds is the reported figure. Correctness, all green in Node **and** the browser:
200/404/500 statuses recorded; aborted fetch propagates `AbortError` to the app and records
status 0; XHR success/404/abort recorded via `loadend`; streamed body byte-identical with
duration measured to headers; template matching for `{id}`, `[id]`, `{id?}`, `{...slug}`,
`[[...slug]]`; query/hash stripped; cross-origin and unmatched dropped; disable restores
the original `fetch` identity and stops collection; re-injection idempotent; dormant
before enable. Production gating: a real `vite build` artifact contains neither
`__facilisMetrics` nor `vv-metrics`; serve mode injects both; `FACILIS_DEV_METRICS=0`
removes them; no metrics route exists in the package.

**20-request dev-server-log comparison** (scripted browser check against the real IDE:
create the generated todo project, enable through the dev handle with the manifest's
route templates, issue 20 `GET /api/todos` from *inside* the preview frame): the buffer
reported `{ route: "/api/todos", count: 20, errors: 0, clientErrors: 20, aborted: 0,
p50Ms: 10, p95Ms: 10 }`; the framework access log (`.facilis/logs/access.jsonl`, read
through the VFS exactly as the Logs panel does) gained exactly 20 `GET /api/todos`
entries, all status 401 — count and status match. Wrong-token and oversized messages
posted live into the IDE window were rejected; disable cleared the buffer and slept the
client. 20/20 checks passed.

**Consequences.** `facilis()` returns one more plugin in dev; a generated project's dev
document carries ~6.5 KB of dormant script until enabled. The runtime lens (#72) consumes
the seam without new transport: it enables with its manifest-derived templates and
subscribes for repaints. The token now reaches the preview document when metrics are
enabled — acceptable: it is a routing identifier, not a secret against the app (mode A
previews are same-origin with the IDE), it never leaves the machine, and batches are
still validated against the *current* boot token. Package versions are **not** bumped:
per D-198 a bump is the release ritual, not a side effect of a source change (recent
package fixes on main ship unbumped); dev builds vendor the workspace (D-196), so the
smoke exercises this change, and a release publishes it when the manifests next bump.

**Verification.** 55 new unit tests: `dev-metrics-client.test.ts` + `vite-dev-metrics.test.ts`
(15, incl. a real production build grepped for the client) and `runtime-metrics{,-buffer,-wire}.test.ts`
(40: rejection by token/origin/size/shape, ring bounds + window expiry, bucket percentile
math, enable/disable wiring). `pnpm lint`, `pnpm typecheck`, `pnpm test` (21/21 tasks),
`pnpm build` (13/13) green; `pnpm ide:browser` + `pnpm ide:smoke` green — **87/87 checks**,
`facilisWarnings: "0"` (the pre-existing smoke caveat of PR #104 was already fixed on main
by D-199/#110, so no caveat applies to this run). The spike directory is retired with this
record; its regression coverage lives in the unit tests above.
