# Draft — Vivari: ESM-only package copies fail the require-first resolver

**Status:** draft, **not filed** — but a **validated patch is ready** (see
[Patch](#patch-prepared-and-validated-not-pushed) below). Target repo:
[maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari). Saved here so the ticket
and PR can be opened later without redoing the investigation.

**Suggested title:** Module resolver cannot load packages whose CJS target is absent —
`resolveExports` stops at the first condition and `loadAsDirectory` does not fall back to
`module`

## Environment

- Vivari **v1.1.2** (submodule pinned at `1f00a48c6d8009e7f369c1cf36959d61ad262b19`),
  loader at `packages/runtime/module.js`.
- Chromium 156, WebContainer, Node-in-browser runtime.
- Project inside the VM: Vite **8.3.5**, `pnpm@9.15.9` with `node-linker=hoisted`,
  `--configLoader native`, Nitro **3.0.260903-beta** (`nitro/vite` imported from
  `vite.config.ts`).

## Impact

A package that is **installed and readable** still fails to load whenever the file its
`main` / `exports["require"]` points at was not shipped, even though an ESM build of the
same entry is present. The error is `MODULE_NOT_FOUND` from
`packages/runtime/module.js` (`load` → `resolveFilename`, throw at ~line 452), so it looks
like a missing dependency and sends users chasing the wrong fix.

Concrete blocker: the Facilis IDE scaffolds a Facilis+Nitro project into the WebContainer and
the generated project's dev server cannot boot, so the preview never paints (~306 s timeout).

## Reproduction (minimal)

1. In a WebContainer project: `package.json` with `nitro@3.0.260903-beta` and
   `vite@8.3.5`, `.npmrc` with `node-linker=hoisted`; `pnpm install`.
2. `node_modules/nitro/dist/node_modules/defu` exists, but contains **only**
   `dist/defu.mjs`; its `package.json` declares `main: "./lib/defu.cjs"` and
   `exports["."]["require"] → "./lib/defu.cjs"` — that file is not shipped.
3. Load something that imports it at module scope, e.g. `require("nitro/vite")` inside the
   VM (or `vite dev --configLoader native`, where the config imports `nitro/vite`).
4. Observed:

   ```
   Error: Cannot find module 'defu' from '…/node_modules/nitro/dist'
       at resolveFilename (packages/runtime/module.js:452:…)
       at load (packages/runtime/module.js:451:…)
   ```

The same install works on real Node: `import("nitro/vite")` resolves `defu` through the
`import` condition (`./dist/defu.mjs`). So this is resolver behaviour, not a broken package.

## Root cause

The runtime loads everything through `require()` — ESM is transpiled to CJS at load — and
therefore resolves like `require()`:

- `EXPORT_CONDITIONS = ["node", "require", "default", "import"]` (module.js:183): the
  `require` condition wins, `import` is last.
- `resolveExports()` (module.js:210) picks **one** condition, then returns `null` if the
  chosen target is missing on disk — it never tries the next condition (`default`,
  `import`) even though the loader would happily transpile the ESM file.
- `loadAsDirectory()` (module.js:257) uses `pkg.main || pkg.module`, so a `module` field
  is only consulted when `main` is *absent*, not when the `main` file is missing.

So for Nitro's traced copies the walk is: `require` target absent → exports miss →
`main` absent → `index` miss → up one `node_modules` level → nothing → throw. The
project's own `node_modules` is the only place that can satisfy the import, which is why
pinning the packages there works.

Affected examples from `nitro@3.0.260903-beta/dist/node_modules` (all ESM-only):

| package | shipped in the traced copy | declared CJS target | result |
|---|---|---|---|
| `defu` | `dist/defu.mjs` | `main` / `require` → `lib/defu.cjs` | MODULE_NOT_FOUND |
| `ufo` | `dist/index.mjs` | `main` / `require` → `dist/index.cjs` | MODULE_NOT_FOUND |
| `destr` | `dist/index.mjs` | `main` / `require` → `lib/index.cjs` | MODULE_NOT_FOUND |
| `scule` | `dist/index.mjs` | `main` / `require` → `dist/index.cjs` | MODULE_NOT_FOUND |
| `croner` | `dist/croner.js` | `main` / `require` → `dist/croner.cjs` | MODULE_NOT_FOUND |
| `unctx`, `cookie-es`, `rendu` | `dist/index.mjs` | `exports` is a plain string | resolves (no bug) |

## Suggested fix

Two narrow changes, either of which unblocks this class of package:

1. `resolveExports()`: when the target file for a condition does not exist, continue with
   the next condition instead of returning `null` — `require` → `default` → `import`.
2. `loadAsDirectory()`: when `pkg.main` resolves to nothing, try `pkg.module` before
   falling back to `loadIndex`.

Both are safe for the runtime's design: it already transpiles ESM to CJS
(`transpileEsm` / `transpileEsmLive` in `esm.js`), and the fallback only runs when the CJS
target is physically absent (today that is a hard failure anyway). A condition-ordered
fallback is what bundlers do and what Node effectively does through the `import` condition.

Suggested unit test: a fixture package with
`{ "main": "./missing.cjs", "exports": { ".": { "require": "./missing.cjs", "import": "./real.mjs" } } }`
— `require("fixture")` must load `real.mjs` (transpiled), not throw.

## Evidence / how this was found

- Facilis smoke run with the generated project's pin list removed: project installs and the
  preview iframe opens, but the preview never paints
  (`FAIL preview painted 306381ms`; 15 checks red). Artifacts:
  `/tmp/facilis-dev/smoke-artifacts/pins-1793172201/` — `report.json`,
  `facilis-diagnostics.json` (IDE terminal text) and `04-facilis-failure.png` (visible
  `/vivari/packages/runtime/module.js:452:39` stack frame).
- Control: same `nitro@3.0.260903-beta` + `vite@8.3.5` install on real Node (pnpm 9.15.9,
  `node-linker=hoisted`) resolves `import("nitro/vite")` with no extra packages.
- Nitro's packaging context (not this bug): the traced copies are intentionally pruned, and
  [nitrojs/nitro#3985](https://github.com/nitrojs/nitro/issues/3985) (closed) documents the
  ghost-dependency family; [#4701](https://github.com/nitrojs/nitro/pull/4701) (merged,
  unreleased as of `3.0.260903-beta`) stops shipping `dist/node_modules` entirely, which
  also removes this reproduction.

## Patch (prepared and validated, not pushed)

- Branch `fix/runtime-esm-only-targets` on `v1.1.2` (`1f00a48c`), commit `e67b450`; the
  `git am`-able patch is [`vivari-esm-only-packages.patch`](./vivari-esm-only-packages.patch)
  and includes the `@vivari/core` changeset (`.changeset/quiet-emus-resolve.md`).
- Validation: with the patch applied to the vendored runtime **and the template's pin list
  removed**, the Facilis smoke passes end to end — preview paints, health/manifest/OpenAPI/401,
  HMR, VFS writes and git commit all pass (only the known A12 OPFS-mirror issue remains).
  Artifacts: `smoke-artifacts/patch-1793208361`. Vivari's `node scripts/smoke-sdk.mjs` also
  passes; `npm run verify` is not runnable here (no Rust/wasm-pack → `packages/vfs/pkg-node`
  missing), CI covers it.
- PR description ready in [`vivari-esm-only-packages-pr.md`](./vivari-esm-only-packages-pr.md).
- **Not pushed:** this environment has no GitHub credentials (`gh auth status` → not logged
  in, no SSH key). To file: fork the repo, push the branch (or `git am` the patch) and open
  the PR with that body.

## Workaround used today

The Facilis template used to pin the reachable set in the generated project's
`package.json` (`@vercel/queue`, `cookie-es`, `croner`, `defu`, `destr`, `picomatch`,
`rendu`, `scule`, `ufo`, `unctx`, `@poppinss/colors`, `@poppinss/dumper`,
`@speed-highlight/core`, `youch-core`) plus `node-linker=hoisted`, so resolution landed on
the project's copies. See `docs/DECISIONS.md` D-024.

**Update (2026-10-29):** the workaround is gone. The fork's resolver fix (PR #19) is in the
pin, the template no longer lists those packages, and the Facilis smoke passes with the whole
list removed (52 checks). `picomatch` and `@vercel/queue` stay only because nitro's tarball
does not vendor them.
