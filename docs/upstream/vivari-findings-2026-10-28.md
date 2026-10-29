# Vivari findings — 2026-10-28 (checks after the two filed workarounds)

Snapshot of the checks run while evaluating Vivari as the IDE kernel. Two problems are already
root-caused and patched (`vivari-esm-only-packages`, `vivari-opfs-mirror-priority`), a third has
a patch ready (`vivari-import-meta-resolve`); this file records the rest, in severity order, with
the evidence collected. Finding 4 is root-caused: it is the proxy's HTTP/2 request cap, not
an engine bug (D-029).

## 1. Worker death after boot hangs the IDE silently — confirmed

**Symptom.** A worker that dies after the kernel booted leaves every filesystem call pending
forever: no rejection, no toast, no console error. `__ide.getSnapshot().kernelReady` stays
`true`, so the UI believes it is healthy.

**How it was reproduced.** Headless Chromium against the running studio; after boot, the
kernel worker target was attached over CDP and closed with `self.close()`. Then
`window.__ide.readdir("/")` never settled (5 s `Promise.race` → TIMEOUT) while `kernelReady`
was still `true` and the page showed no error.

**Why the FS worker is the same shape.** `kernel-worker.ts` resolves `fsReady` during boot and
its comment states that after that point an `onerror` from a *running* FS worker is a no-op
(by design, to avoid tearing down a healthy boot on a non-fatal uncaught exception). There is no
post-boot liveness check for either worker.

**Suggestion.** A heartbeat/watchdog on the kernel and FS workers (the kernel already has one for
guest *processes*), surfacing a terminating error to the IDE rather than leaving a silent hang;
or make `KernelBridge` reject in-flight RPCs when a worker target disappears.

## 2. `navigator.storage.persist()` is never requested — confirmed

**Measured in the real page:** `navigator.storage.persisted() === false`, quota ≈ 10.7 GB,
usage ≈ 82 KB (fresh profile). Nothing in `packages/core` or `packages/kernel-host` calls
`persist()`, so the whole project tree + dependency cache in OPFS is best-effort storage and
can be evicted by the browser under pressure — a silently lost project, not a crash.

**Suggestion.** Call `navigator.storage.persist()` once at boot (best-effort, after the first
user gesture if Chrome's heuristics require it) and surface the answer (`persisted` vs
`evictable`) in the studio.

## 3. Two tabs on one origin: clobbered mirror index, wrong preview, empty restores — confirmed and fixed (2026-10-29)

Two tabs are a real use case for the IDE (D-033 in the superproject), so this was measured with
two Chrome tabs on one origin, one React project in each, both dev servers running.

- **Two kernels coexist fine.** The second tab's `kernel-online` is +2.5-2.9 s (it restores the
  shared tree); the pair costs ~355 MB + ~362 MB of JavaScript/worker memory; OPFS holds 308 MB,
  shared (quota 11 GB, `crossOriginIsolated` true).
- **The mirror index was clobbered, as predicted.** `writeManifest()` serialized this kernel's
  whole `meta`. After tab A wrote one file, the index held 0 of tab B's 10 paths, and reloading
  tab B lost its project (`vv-stat` → does not exist). Fixed by tracking this kernel's changed
  paths and read-merge-writing exactly those into the index on disk, under a `vv-vfs-manifest`
  Web Lock (`fix/opfs-crosstab-index`).
- **A boot reading a mid-write index restored nothing.** OPFS has no rename and the writer did
  `truncate(0)` + `write()`, so for a few milliseconds the index is EMPTY. A tab that booted in
  that window parsed nothing and restored an empty workspace — measured, with the index intact
  afterwards. Writers now stage a complete `manifest.json.new` and `move()` it over the live
  index; readers try the staged copy and retry, and never overwrite an index they could not parse.
- **Preview routing was per origin, not per kernel.** `handlePreview` posted every `/preview/5173/`
  request to one "window that hosts a kernel". Measured: a fetch of `/preview/5173/` issued by tab
  A returned tab B's app, and reloading tab A's preview painted tab B's project. Fixed by routing
  on the requesting client: a navigation belongs to the window that started it (`event.clientId`),
  and the frame it creates (named by `resultingClientId`) remembers its kernel, so that frame's
  subresources go back there (`fix/preview-per-tab-kernel`). keep-prefix ports and ws/SSE tunnel
  frames became per kernel for the same reason.

**Suggestion.** Both fixes ship in the fork. A Studio that wants tabs should also refuse one
project in two tabs with a Web Lock (the browser releases it with the document, so a crashed tab
cannot hold it), and give each tab a `?project=` identity so a reload lands back on its project.
`vv-depcache`'s own index is a single blob too, and two tabs installing at the same time can lose
one snapshot entry (the blob stays, the index entry does not) — wasted bytes, not corruption, and
not fixed here.

## 4. The studio behind an external HTTPS proxy: the proxy's HTTP/2 request cap — root-caused, environment fix

**Environment.** `https://facilis.home` (nginx in front of the Vite dev server, self-signed
cert accepted with `--ignore-certificate-errors`), same repo state that passes locally on
`http://127.0.0.1:<port>`.

**What works over the proxy.** TLS 200, COOP/COEP headers, kernel online (~0.6–0.8 s), project
created, `/sw.js`, vendor tarballs and `vendor/pnpm-pack.bin` all fetch correctly (200), and
in-VM `https.get("https://host.vivari.internal/vendor/…")` from a shell returns **200** — the
alias and the HTTPS egress are fine.

**Root cause (2026-10-28).** It is the proxy's HTTP/2 connection lifetime, not the engine.
nginx retires each HTTP/2 connection after **1000 requests** (`http2_max_requests 1000`, the
default; nginx ≥ 1.25.1 folds it into `keepalive_requests`, also 1000). Measured against
`facilis.home` with a bare Node HTTP/2 client: `GOAWAY` arrives on request #1000 exactly
(`lastStreamID=1999`, advertised `max_concurrent_streams=100`). A page session of the IDE in dev
issues **thousands** of module requests — every guest process is a browser Worker that loads the
runtime's ~190-module ES-module graph (the build ships one file per worker; dev serves each module
separately), so ~19 processes ≈ 3,600 requests, i.e. 3–4 connection retirements per run. Chromium
loses a few in-flight module fetches across that boundary (`net::ERR_FAILED`, no HTTP response).
A module Worker whose graph fails to load fires `error` with an **empty message**, which
`kernel-worker.ts` classifies as a fatal boot failure — so the kernel prints `worker.js: process
worker failed to start (worker terminated without an error message)` and finalizes it with code 1,
and pnpm's pool then dies with `Worker pnpm#4 exited with code 1`.

Measured, each run isolating one variable:

- A loopback HTTP/2 proxy in front of the same Vite dev server, with **only** a `GOAWAY` after
  1000 requests added: **5 of 19** simultaneous module Workers fail. The identical proxy without
  that cap: **0 of 19**. That is the whole mechanism.
- Real proxy, 19 module Workers at once: 1–6 fail, a *random* module each run (`bun-cookie.js`,
  `bun-html-rewriter.js`, `perf/observe.js`, `boot.js`, …). The same 19 over the same nginx with
  `--disable-http2`, or over loopback: 0. HTTP/1.1 has no multiplexed in-flight requests to lose
  when a connection retires, which is why the loopback smoke was always green.
- Worker module-graph fetches do **not** reuse the browser HTTP cache: a warm Worker still fetched
  193/193 modules, and a warm 19-Worker burst still issued 3,039 `vendor/vivari/**` requests. A dev
  middleware serving `vendor/vivari/**` with `Cache-Control: max-age=60` changed nothing and was
  reverted — request *volume* crosses the boundary, cacheability does not help.
- pnpm, `worker_threads`, the SAB/MessagePort handoff, the `host.vivari.internal` alias, the
  certificate and a cold/warm dev server are exonerated: a cold server only widens the window
  (fetches stay in flight longer), it does not change the cause.

**Fix (environment, no engine change).** On the studio vhost, raise or disable the per-connection
request cap — `keepalive_requests 100000;` on nginx ≥ 1.25.1, `http2_max_requests 100000;` on
older — or serve the dev server over HTTP/1.1 (`http2 off`; dev does not need h2), which is a
complete workaround. Raising `http2_max_concurrent_streams` (the proxy advertises 100) also helps
the burst.

**Fix in the IDE (D-031).** The dev script now runs Vite's full-bundle mode
(`vite --experimentalBundle`): middleware mode's one-request-per-module traffic is what made a
process Worker load a 190-request graph on every spawn, and bundle mode removes that volume
instead of pacing it. With the proxy **unchanged** (still retiring HTTP/2 connections at 1000
requests), `TEMPLATE=Facilis pnpm ide:smoke` is green end to end over `https://facilis.home/`
— preview painted, framework checks, A8/A9/A10 and the A12 OPFS probe — where middleware mode
failed 15 checks on the same proxy. The loopback smoke is green in both modes, and
`dev:middleware` keeps the old server for Vite-plugin/HMR debugging.

Rejected, measured rather than argued: throttling concurrent Process Worker boots in the kernel.
A validated patch capped boot bursts at three (with a `proc-booted` signal from the
process-worker entry) and does **not** fix this — the request volume still crosses the 1000
boundary, so it only shifts the probability; the patch was dropped. Capping pnpm's pool from the
generated template (`PNPM_WORKERS`) fails the same way and puts a browser-VM limitation into
user-visible project configuration. Retrying a boot whose graph failed is possible, but needs a
bridge for every transferred port (`parentPort`, `workerData` ports); not worth it when the proxy
is the thing that should not retire a dev connection every 1000 requests.

**Separate, corrected note.** The proxy does **not** answer missing `/vendor/locks/index.json`
and `/vendor/depcache/index.json` with the SPA shell — **Vite itself** does (verified on
loopback: `Accept: */*` → 200 `text/html`, `Accept: application/json` → 404). The loader logs a
JSON parse error and installs from scratch either way; a dev-server 404 for unknown `/vendor/*`
would be the tidy fix.

## 5. Already patched (recorded elsewhere)

- ESM-only package copies vs the require-first resolver — `vivari-esm-only-packages`.
- OPFS mirror backlog + manifest gated on an empty queue — `vivari-opfs-mirror-priority`.
- `import.meta.resolve` returning a path instead of a URL — `vivari-import-meta-resolve`.

## 6. Toolchain age: the vendored pnpm is three majors behind (measured 2026-10-29)

Everything else in the VM tracks current upstream: `process.versions.node` reports **v24.18.0**
(`packages/runtime/builtins/process.js`), the fork's base is upstream **v1.1.3** — still the newest
release — and our three fix commits are on top of it. The stale piece is the packaged pnpm:
`scripts/vendor-pnpm.mjs` pins **9.15.9** (Jan 2025) while the registry's `latest` is **12.16.1**
(`latest-10` 10.34.9, `latest-11` 11.28.9).

The version is not a free bump, because pnpm changed *shape* twice since:

| version | npm package shape | engines | usable in the VM? |
|---|---|---|---|
| 9.15.9 (vendored) | CJS: `bin/pnpm.cjs` → `dist/pnpm.cjs` + `dist/worker.js` + `dist/node_modules` | ≥18.12 | yes (baseline) |
| 10.34.9 | same CJS shape, byte-for-byte same layout the packer walks | ≥18.12 | **no — dies while loading `dist/pnpm.cjs`** (see below) |
| 11.28.9 | pure ESM: `bin/pnpm.mjs` → `dist/pnpm.mjs` (15.5 MB), no `dist/worker.js` | ≥22.13 | no — store index does `req("node:sqlite")` at init, and the runtime does not serve `node:sqlite` (`index.js` lists it as absent) |
| 12.16.1 (`latest`) | wrapper: `install.js` + `native-binary.mjs` + pre/postinstall that link and `spawn` `@pnpm/exe.<platform>/pnpm` | ≥18 | **impossible** — a native executable has no meaning in a browser container |

Measured, not inferred:

- **The packer still works unchanged.** Only the version constant changed: `pnpm-pack.bin` builds
  1061 files / 4.19 MB gz (9.15.9: 898 files / 3.66 MB gz), still with `bin/pnpm.cjs`,
  `dist/pnpm.cjs` and `dist/worker.js`. Both anchors the loader checks stay valid.
- **The guest install dies at load, not at resolution.** With the 10.34.9 pack swapped in (artifacts
  are gitignored) and the generated project's `packageManager` bumped in lockstep,
  `TEMPLATE=Facilis pnpm ide:smoke` fails 15 checks: the preview never binds, and the terminal
  shows the guest `pnpm` throwing out of `/usr/lib/node_modules/pnpm/dist/pnpm.cjs` while loading
  its own require helper. Nothing else changed — the same tree, pack and harness are green on
  9.15.9, and A8/A12 write and OPFS checks still pass in that run because they do not need the
  dev server. So pnpm 10 is a loader/builtin-surface incompatibility to be captured and fixed,
  not a version constant to raise. The full message is the first thing to collect if we pick this up.
- **The pin must move with the asset.** pnpm 10 turns `manage-package-manager-versions` on by
  default: the generated project's `packageManager: "pnpm@9.15.9"` (`ide/src/facilis/project-files.ts`,
  D-022) would make the vendored 10.x download *and re-exec* 9.15.9 inside the VM. Bump both or
  neither.
- **The asset is load-bearing beyond installs.** `scripts/dev/vendor-assets.sh` ships it because
  rolldown's in-VM fallback runs `pnpm i @rolldown/binding-wasm32-wasi` when a Vite guest starts;
  any bump has to re-run the Facilis smoke (Vite 8 + rolldown), not just an install test.

Recommended order if we take it: (1) capture the 10.34.9 load failure, (2) ship 10.34.9 — that is
the last JS-distributed, CJS-loadable shape and the only one that can land in a bounded change,
(3) only then consider 11.x, which is gated on a `node:sqlite` implementation in the runtime
(`DatabaseSync`/`StatementSync`; the wasm is already shipped at `ide/public/vendor/sqlite/` for
guests, so it is a bindings job, not a research job). 12.x is out of reach for every browser-based
container, not just this one.


**Decided (2026-10-29):** no 10.x spike. The generated project installs with **npm** instead — the
IDE vendors npm 12.2.1 and the `@facilis/*` tarballs are copied into the project as `file:`
dependencies, so no install touches HTTP at all (D-032). pnpm stays in the VM only as the tool
rolldown invokes for its wasm binding, pinned and internal. The 11.x ceiling above is therefore
not on our path any more; it would matter only if a project had to install with pnpm.
Other engine gaps worth a one-line upstream PR when we are in there, none blocking Facilis today:
`fsPromises.cp` routes into the unimplemented sync path (`node/lib/fs/promises.js`, one line) while
`fs.cp` works; `node:sqlite` is absent (see above); `http2` is a load-safe stub; `readline` is
partial; `worker_threads` still cannot transfer complex objects.


