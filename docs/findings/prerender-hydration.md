# Can prerender + hydration run inside the WebContainer? (issue #80, epic #79)

Measured on 2026-11-23 with the standalone spike `spikes/prerender-hydration/`
(React 19.3.1, react-router-dom 7.18.5, nitro 3.0.260903-beta; three routes:
static `/`, public-API `/stats`, auth-guarded `/app`). Host: Node 26.13.1
(linux x64). In-VM: the real Studio driven through CDP
(`spikes/prerender-hydration/run.mjs`), Node v24.18.0 / wasm32, vendored npm
12.2.1, on both template stacks — `vite@7.3.8` (the generic-template `^7.1.0`
pin) and `vite@8.3.5` + `rolldown@1.2.15` + `@rolldown/binding-wasm32-wasi` +
the `@emnapi/*@2.0.0-beta.2` overrides (DEV.md §6.1).

**Answer: yes — all three arms prerender AND hydrate in-VM, on both stacks.**
The D-024 prediction (Nitro's `node-worker` prerenderer cannot boot in-VM) did
**not** reproduce on the current fork: the env-runner worker boots, and Arm A
prerendered both routes in 0.908 s inside the VM.

## Recommendation: Arm C (custom in-process pass), Arm A proven viable

- **Arm C — recommended for the shipping build step (#83).** A `closeBundle`
  pass builds an SSR bundle, imports it in the same realm (the runner-"self"
  philosophy, D-024), renders the allowlist with build-time public data fetched
  over localhost HTTP, and writes HTML + XSS-escaped state + sitemap + an empty
  shell fallback. Every epic rule is explicit in ~100 lines of framework-owned
  code: opt-in allowlist, fail-closed data errors, no identity, no worker, no
  third-party plugin. Lightest build of the three (host 244–762 ms; in-VM
  1.0–1.8 s).
- **Arm A — Nitro-native: viable fallback.** Works in-VM on both stacks, but
  carries the most gotchas (below): a second Nitro build + worker per build
  (host peak RSS 585–948 MB), `noExternals` required for CJS deps, the
  index.html template-mode trap, and a dependency on the fork's worker_threads
  emulation staying healthy. Reusing upstream machinery is attractive; the
  worker fragility history (D-024) argues against betting the contract on it.
- **Arm B — vite-prerender-plugin: viable reference, not recommended to ship.**
  Node-only and proven, but the data island is serialized with plain
  `JSON.stringify` (no XSS escaping), link crawling is on by default, the
  preview fallback is a directory prefix, and the prerender script rides the
  CLIENT build (node: builtins need explicit `external`).

## Results

Build wall time / peak RSS (guest `process.memoryUsage`, sampled at 100 ms):

| Stack | Arm | Host wall | Host peak RSS | In-VM wall | In-VM guest RSS* | Hydration in-VM (/ , /stats , /app) |
|---|---|---|---|---|---|---|
| vite 8.3.5 | A | 588 ms | 584.9 MB | 2146 ms | 64 MB* | pass / pass / pass |
| vite 8.3.5 | B | 255 ms | 437.3 MB | 1061 ms | 64 MB* | pass / pass / pass |
| vite 8.3.5 | C | 244 ms | 291.8 MB | 1012 ms | 64 MB* | pass / pass / pass |
| vite 7.3.8 | A | 2030 ms | 948.1 MB | 4290 ms | 64 MB* | pass / pass / pass |
| vite 7.3.8 | B | 990 ms | 448.4 MB | 2196 ms | 64 MB* | pass / pass / pass |
| vite 7.3.8 | C | 762 ms | 326.1 MB | 1781 ms | 64 MB* | pass / pass / pass |

Hydration = `hydrateRoot` with **zero recoverable errors**, per-route title and
content present, `/stats` hydrated from the embedded state (`data-source="prerender"`,
no refetch), `/app` a client-only shell (`createRoot`, auth-shell marker).
Host hydration verified separately in headless Chromium for every vite 8 arm and
vite 7 arm C. In-VM install: 30.1 s cold (vite 7), 7.5 s warm (vite 8); kernel
online 3.1 s cold. Six full in-VM runs; the final two are all-green (50/50
checks) and wall times agree within ~10% across runs. The served HTML is also
fetched from inside the VM (direct to the preview server, bypassing the SW) and
carries the content markers; browser renders are captured as
`results/page-*.png`.

\* **Memory observability is limited in-VM.** The guest's `process.memoryUsage`
is emulated (it plateaus at 64 MB RSS / 20 MB heap regardless of arm), and the
kernel's per-process heap query (`__vv.diag()`) returned `heapBytes: -1`
(unobservable) for every process. Physical peak memory therefore cannot be
measured from inside the VM with today's seams; SPEC §13 risk 5's mitigation is
"measure; document limits", and the documented limits are: a 3-route app builds
in 1–4.3 s in-VM, the project VFS sits at ~115 MB after install + builds, and
host-side peak RSS for the same builds is 292–948 MB (Arm A on vite 7 heaviest:
second Nitro build + rolldown prerenderer + worker). The ~50-route scaling
question (risk 5's impact column) is **not** answered by a 3-route spike; #85's
smoke gate should carry a larger fixture.

## Acceptance criteria → evidence

- **Real prerendered HTML in-VM + hydration, zero recoverable errors:** all six
  stack×arm combinations; HTML read back from the VFS carries
  `id="home-content"` / `id="stats-content"`, per-route `<title>`, and the
  `#prerender-data` state island; browser preview pages report
  `__PRERENDER_MODE__="hydrate"`, `__PRERENDER_ERRORS__=[]`.
- **`/app` never prerendered, no error bodies, no identity:** no `app/index.html`
  in any output; the allowlist is the only render set; `/api/private` answers
  401 at runtime and is never rendered; the renderer fails closed to the shell
  on data errors; no session/system identity exists in the spike.
- **`vite build` completes in-VM, wall time + memory recorded:** table above;
  `vite build` had never been exercised in-VM before this spike.
- **Failure modes documented:** the catalog below.
- **Findings + recommendation:** this document; the spike retires per D-006 when
  the decision (#81) lands.

## Failure modes and gotchas (catalog)

1. **D-024 did not reproduce for the prerenderer.** `EnvServer({runner:
   "node-worker"})` boots in-VM (kernel workers `worker.mjs` / `wasi-worker.mjs`
   visible in `__vv.diag()`); the fork's worker_threads emulation has moved on
   since the dev-runner decision. The dev runner still uses `runner:"self"`.
2. **Nitro's bare default is `serverDir: false`.** Standalone `nitro()`
   registers NO API routes (neither the app nor the prerenderer) until
   `serverDir` is set; the Facilis wrapper already sets `./server`
   (FACILIS_NITRO_DEFAULTS), so generated projects are unaffected.
3. **The prerenderer externalizes deps to `file://` URLs under node
   conditions.** react-router-dom's node entry is CJS → `Named export 'Link' not
   found`; `cookie`'s resolved path does not exist. `noExternals: true` fixes
   both (the main node-server build already inlines its libs).
4. **index.html switches Nitro to template-renderer mode.** With an index.html
   present, Nitro serves it as the renderer template and the SSR entry's fetch
   is bypassed (empty-shell output). The official vite-ssr-react mode — entry
   fetch returns the whole document — requires NO index.html.
5. **The prerender request URL carries no port** (h3 builds it from the route
   path), so a loopback self-fetch inside the prerender worker is ambiguous.
   Direct same-realm import of the public data function is the robust pattern;
   arms B/C fetch `http://127.0.0.1:<port>` from their own in-process server
   instead (works in-VM).
6. **Arm B rides the client build.** node: builtins become
   `vite-browser-external` stubs (vite 8) → `external: [/^node:/]` is required;
   `previewMiddlewareFallback` is a DIRECTORY prefix (it appends
   `/index.html`); the data island is unescaped `JSON.stringify` (XSS); link
   crawling is on by default (the spike's button nav keeps `/app` undiscovered).
7. **Hydration under the IDE preview needs the preview basename.** The
   same-origin preview serves under `/preview/<port>/` while the VM server sees
   root paths: the client router must use that prefix as its basename (the
   generated template already does via `appBasePath()`). Without it, no route
   matches and every page fails with React #418. Server-rendered `<a href>`
   values can never match the basename-rewritten client hrefs — the spike uses
   button nav; the shipping runtime (#83) must solve hrefs explicitly (or use
   the root-served isolated preview mode).
8. **In-VM `process.exit` inside a promise handler surfaces as a catchable
   unwind** — a `.catch` misreports it as a failure (the minifier probe printed
   MINIFY_OK then "failed"). Exit codes from top-level `process.exit` are fine.
9. **The native-minifier question is separate and green.** Default minification
   builds in-VM on both stacks (esbuild → `esbuild-wasm@0.28.2` via the kernel's
   fetcher alias; vite 8 → oxc through the rolldown wasm binding). The spike
   builds with `minify: false` to isolate prerender mechanics.
10. **"Accidental rolldown" on the Vite 7 path is real and harmless today.**
    In-VM, `rollup` resolves to `@rollup/wasm-node@4.68.8` (kernel fetcher
    alias), and nitro pulls `rolldown@1.3.3` + its wasm32 binding transitively
    even when the project pins vite 7 — the 1.3.3 binding boots WITHOUT the
    emnapi overrides that 1.2.15 needed (upstream rolldown#11292 landed). The
    Vite 7 dev/build path is unbroken; the prerenderer's rolldown build resolves
    from nitro's transitive dep, not the project pin.
11. **`?assets=client` / `?assets=ssr` queries work on both pinned Vites**
    (7.3.8 and 8.3.5); the emitted HTML carries the hashed entry + modulepreload
    tags.
12. **Build-time fetch/CORS.** Localhost HTTP fetch at build time works in-VM
    (arms B/C). Node build-time fetch has no CORS; external public APIs were not
    exercised against a real external origin (the VM's fetcher worker carries
    registry traffic, so outbound fetch is expected to work — #83 should verify
    with a real external endpoint). Browser-side CORS is unchanged.

## Verification

- Host: 6/6 builds green; hydration green in headless Chromium (vite 8 arms
  A/B/C, vite 7 arm C) via the same CDP helpers the smokes use.
- In-VM: six full runs, final run 50/50 checks green
  (`$FACILIS_TOOLING_DIR/spike-prerender-hydration/1795441200322/report.json`;
  artifacts are ephemeral — the durable summary is
  `spikes/prerender-hydration/results/report.json`, with page renders in
  `results/page-*.png`).
- Repo gates on the findings branch: `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm build` — all exit 0. The spike is standalone (not a
  workspace member, D-006); no shipped code changes.

## Follow-ups (not in this change)

- **#81 (decision):** record the contract. NOTE: the epic body's "D-195 (next
  free ID)" is stale — D-195..D-201 are taken; the decision must use the next
  free ID at authoring time.
- **#83 (build step):** implement the Arm C shape in the framework (allowlist
  declaration, fail-closed eligibility, XSS-escaped serializer, sitemap, shell
  fallback, preview basename/href contract from gotcha 7).
- **#85 (smoke):** carry a larger route fixture for the risk-5 scaling question.
- Retire `spikes/prerender-hydration/` per D-006 once the decision lands.
