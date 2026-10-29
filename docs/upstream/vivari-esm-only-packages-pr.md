# PR draft — fix(runtime): load ESM-only package copies when the CJS target is missing

**PR:** [#19](https://github.com/maitrungduc1410/vivari/pull/19) (opened 2026-10-29). Branch
`fix/runtime-esm-only-targets` on `kele23/vivari`, based on `v1.1.4` (`8e91ade`); commit
`86a20ce`. The same change applies with `git am docs/upstream/vivari-esm-only-packages.patch`
(includes the changeset).

**Base repo:** [maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari)

## Summary

The module resolver picks a single `exports` condition (CJS-first by design) and throws
`MODULE_NOT_FOUND` when that target is missing, even when another condition's file exists.
`loadAsDirectory()` has the same shape: it only looks at `pkg.module` when `pkg.main` is
absent, not when the `main` file is missing from disk. Packages published as **pruned,
ESM-only copies** therefore fail to load although they are installed and carry a loadable
ESM build.

## Root cause (reproduction)

Nitro `3.0.260903-beta` ships its traced dependencies as ESM-only copies under
`dist/node_modules`: `defu` declares `main: ./lib/defu.cjs` and
`exports["."].require → ./lib/defu.cjs`, but the tarball only contains
`dist/defu.mjs`. In a browser WebContainer, a project on that Nitro version (Vite 8.3.5,
`pnpm@9.15.9`, `node-linker=hoisted`, `--configLoader native`) dies inside
`packages/runtime/module.js`:

```
Error: Cannot find module 'defu' from '…/node_modules/nitro/dist'
    at load (packages/runtime/module.js:451:…)
```

On real Node the same install resolves `defu` through the `import` condition. The same
pattern hits `ufo`, `destr`, `scule` and `croner` in that tree.

## Change

- `resolveExports()`: collect every candidate target in condition order
  (`node` → `require` → `default` → `import`) and return the first one that exists on
  disk, instead of stopping at the first picked condition.
- `loadAsDirectory()`: when `pkg.main` resolves to nothing, try `pkg.module` before
  `loadIndex`.
- `pickCondition()` is kept for wildcard subpath patterns, where the target is rewritten per
  request and only one candidate matters.

Loading the ESM build is safe: this runtime transpiles ESM to CJS at load
(`esm.js`/`transpileEsm`), and the fallback only runs when the preferred target is
physically missing — today a hard failure.

## Verification

- **End-to-end in a browser WebContainer** (Vite 8.3.5 + `nitro@3.0.260903-beta`,
  `pnpm@9.15.9`, `node-linker=hoisted`): a generated Vite + Nitro project boots its dev
  server and the preview paints **with none of the extra dependencies the project pinned
  before** — health, manifest, OpenAPI, 401, HMR, VFS writes and git commit all pass.
  Without the patch the same project times out at the `defu` import (error thrown from
  `runtime/module.js:452`). Artifacts: `smoke-artifacts/patch-1793208361` (report.json +
  screenshots) from the Facilis IDE harness.
- `node scripts/smoke-sdk.mjs` (static SDK/packaging guard): **PASS**.
- `npm run verify` was **not** run locally: this machine has no Rust toolchain/wasm-pack, so
  `packages/vfs/pkg-node` (imported by `scripts/fs-worker.mjs`) cannot be built. CI covers
  it; nothing in the change touches the Wasm/VFS layers.
- **Downstream confirmation (2026-10-29):** the Facilis project template no longer pins any
  of those packages — a generated project installs and boots `TEMPLATE=Facilis pnpm ide:smoke`
  green (52 checks) with the whole pin list removed, which is exactly the failure this fallback
  fixes. Only `picomatch` and `@vercel/queue` stay pinned: nitro does not vendor them.
- Changeset included: `.changeset/quiet-emus-resolve.md` (`@vivari/core`, patch).

## Notes

- Nitro packaging context (not the root cause here): nitrojs/nitro#3985 (closed) and
  nitrojs/nitro#4701 (merged, unreleased as of `3.0.260903-beta`), which stops shipping
  `dist/node_modules` and would also stop reproducing this.
- The fix is deliberately conservative: no change to the condition order itself, only a
  fallback that previously ended in `MODULE_NOT_FOUND`.

## Files

- `packages/runtime/module.js` — resolver fix (+39/−27).
- `.changeset/quiet-emus-resolve.md` — patch changeset for `@vivari/core`.
