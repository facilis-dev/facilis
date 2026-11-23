# Spike — Node-only prerender + hydration in the WebContainer (issue #80)

Temporary experiment, not shipped, not a workspace member (D-006). Retired once
the D-195-family decision lands (epic #79, child #81).

Proves the risky in-VM assumptions before the prerender contract decision:

- **Arm A — Nitro-native:** auto-detected `src/entry-server.tsx` (official
  vite-ssr-react pattern), `prerender.routes` allowlist, `?assets=client/ssr`
  queries. Nitro's prerenderer builds a second server bundle and boots it in an
  `env-runner` `node-worker` (worker_threads) — the D-024 suspect.
- **Arm B — vite-prerender-plugin:** Node-only `generateBundle` pass; the built
  prerender chunk is imported in-process (`file://`), no workers/DOM/browser.
- **Arm C — custom in-process pass:** a `closeBundle` step builds an SSR bundle,
  imports it in the same realm (runner-"self" philosophy), renders the allowlist
  with build-time public data fetched over localhost HTTP, writes HTML + state.

Three routes, one table (`src/app.tsx`): static `/`, public-API `/stats`
(`permission: []`-style endpoint, no auth/session/system identity), auth-guarded
`/app` (never prerendered; SPA shell fallback). Client: `hydrateRoot` with
`onRecoverableError` collection, SSR-safe `initTheme/initI18n`, XSS-escaped JSON
state island (`#prerender-data`).

Two template stacks: `package.vite7.json` (generic-template pin `vite@^7.1.0`,
rollup, no rolldown binding) and `package.vite8.json` (fullstack template:
`vite@8.3.5` + `rolldown@1.2.15` + `@rolldown/binding-wasm32-wasi` + the
`@emnapi/*@2.0.0-beta.2` overrides, DEV.md §6.1). `build.minify: false` isolates
the prerender mechanics from the native-minifier question; the runner probes the
default minifier separately.

## Run

Host (plain node, per variant):

    cd spikes/prerender-hydration/app
    cp package.vite8.json package.json   # or package.vite7.json
    npm install
    echo c > spike-arm.txt               # a | b | c
    node scripts/build-measured.mjs      # writes .spike/build-report.json

In-VM (real Studio through CDP; needs the DEV.md artifacts: `pnpm ide:wasm`,
`pnpm ide:assets`, `pnpm ide:browser` in the IDE checkout):

    node spikes/prerender-hydration/run.mjs [--arms a,b,c] [--variants vite7,vite8] [--ide-repo PATH]

The runner materializes the spike project via `vv-create-project` (custom
manifest, no template leftovers), installs with the vendored npm, runs each arm
through `proc-spawn`, reads the emitted HTML from the VFS, serves the build
in-VM on port 4173 and verifies hydration in real browser preview pages
(`/preview/4173/` via the SW). The IDE itself is unchanged; by default it runs
from the main checkout (`--ide-repo` overrides).

Artifacts: `$FACILIS_TOOLING_DIR/spike-prerender-hydration/<timestamp>/`
(report.json, per-arm build reports, proc logs, diag samples, HTML copies,
screenshots). Durable evidence: `results/report.json` (compact all-green run)
and `results/page-*.png` (real browser renders of the served pages).
Findings + recommendation: `docs/findings/prerender-hydration.md`.
