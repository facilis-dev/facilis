# D-024 — Nitro runs in the WebContainer through the in-process runner
**Status:** accepted (2026-10-28, Phase 0 browser spike; first green Facilis smoke)

Because the generated project's Vite config is loaded natively (D-023), Nitro's shipped dist
is executed as-is by the VM's ESM loader instead of being bundled for the browser. Two
packaging facts then decide whether the dev server boots:

1. **Nitro's traced `dist/node_modules` copies are ESM-only, and the VM loader resolved CJS
   conditions.** `nitro@3.0.260903-beta` does ship its external imports under
   `dist/node_modules`, but pruned to the ESM build: `defu` declares `main`/`require` →
   `lib/defu.cjs`, which is absent (only `dist/defu.mjs` ships), and `ufo`, `destr`, `scule`,
   `croner`, `rendu`, `youch` and the rest are pruned the same way. Node's ESM loader would
   pick the `import` condition; the VM loader (`vendor/vivari/packages/runtime/module.js`,
   `resolveFilename`) picked the CJS/`main` target even for ESM imports and did not fall back
   to `module` when that file was missing. Resolution then walked up to the project's
   `node_modules`, found nothing, and the boot died with `Cannot find module …` (thrown from
   `module.js:452`). **Resolved in the fork** (`fix/runtime-esm-only-targets`, PR #19): the
   resolver now collects every candidate target in condition order and returns the first one
   that exists on disk, so the vendored ESM copies load. The template therefore no longer
   pins them: measured 2026-10-29 on the pinned fork, with the whole pin list removed,
   `TEMPLATE=Facilis pnpm ide:smoke` → **SMOKE PASSED** (52 checks, preview painted, A12 OPFS
   restore included), and the generated `package.json` is ~320 bytes lighter. Two packages
   stay pinned because nitro does not vendor them: `picomatch` (nitro's builder
   `__require`s it at run time) and `@vercel/queue` (lazy-imported only by the Vercel Queues
   preset). Dropping those needs a build / Vercel-path check, not a dev smoke.
2. **The out-of-process dev runners cannot start.** `node-worker` and `node-process` resolve
   their entry with `fileURLToPath(import.meta.resolve(...))`; the VM runtime's
   `import.meta.resolve` does not hand back a file URL, so `fileURLToPath` throws
   `TypeError: Invalid URL`. `devServer: { runner: "self" }` keeps the Nitro environment in
   the Vite dev-server process. With that runner Nitro owns the listening socket on port
   3000, so the template's preview port is **3000**, not Vite's default 5173 — one process,
   one origin, which is the property SPEC §10.6 actually needs (the roles are swapped: Nitro
   fronts Vite instead of the other way round).

**Fix candidates:** the next Nitro RC bundles the runtime and stops shipping
`dist/node_modules` (nitrojs/nitro #4701, merged but unreleased — the latest npm beta is
still `3.0.260903-beta`), which removes the traced ESM-only copies; the other half is
Vivari's loader honouring the `import`/`module` condition and falling back to `module` when
`main` is missing (upstream). A patch for that half is prepared and validated — Facilis smoke
green with the template pins removed — and is carried by the fork pin (D-030, branch
`fix/runtime-esm-only-targets`) and was filed upstream as PR #19 (merged in `v1.1.5`). The
template's 14-package pin
list is therefore redundant: dropping it and re-running `TEMPLATE=Facilis pnpm ide:smoke` is a
follow-up. Vite's `--configLoader`
does not help: all three modes externalise package imports (the default `bundle` loader
resolves every dependency to a file URL and marks it `external`), so no loader inlines
Nitro's dist, and `bundle` cannot run in the WebContainer anyway.

**Consequences:** the Facilis smoke is green end to end in the WebContainer — preview painted
(~36-40 s cold), `/__facilis/health` ok, `/__facilis/manifest` ok with **zero warnings**
(PGlite opened, migrations + seed + app role applied), `/_openapi.json` carries
`x-db-tables` for `/api/todos`, and an unauthenticated `/api/todos` returns 401. Upstream
work worth filing: the Nitro RC that bundles the runtime (nitrojs/nitro #4701) and Vivari's
`import.meta.resolve` returning a file URL. Client-side HMR through the swapped
Nitro-fronts-Vite arrangement is the first thing to verify in the next phase.
