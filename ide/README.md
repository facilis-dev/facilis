# Facilis IDE

The Facilis IDE is the browser IDE for Facilis: a VS Code-style app that runs a generated
Facilis project inside a WebContainer, where `vite dev` is the single dev server and
**Nitro v3 runs as a Vite plugin** (SPEC §10.6).

**It starts from the current Vivari Studio** — upstream `packages/studio` at tag `v1.1.2`
(commit `1f00a48c6d8009e7f369c1cf36959d61ad262b19`), imported in full — **and forks from
here.** The upstream kernel stays a pinned git submodule at [`vendor/vivari/`](../vendor/vivari)
(`git submodule update --init`, update with `git submodule update --remote vendor/vivari`);
it is never edited.

| | |
|---|---|
| Upstream repository | <https://github.com/maitrungduc1410/vivari> |
| Upstream tag / commit | `v1.1.2` / `1f00a48c6d8009e7f369c1cf36959d61ad262b19` (branch `master`, 2026-10-16) |
| App source | upstream `packages/studio/` |
| Kernel | [`vendor/vivari/`](../vendor/vivari) — submodule, read-only |
| License | MIT — [`LICENSE`](./LICENSE) (Copyright (c) 2026 Duc Trung Mai and Vivari contributors); Facilis code is covered by the root [`LICENSE`](../LICENSE) |

## Layout

```
ide/                        # this app — the fork surface
├── src/                    # editor UI, IdeController (src/vv), panels
├── public/                 # static assets (SW, DevTools shims)
├── index.html
├── vite.config.ts          # COOP/COEP, Monaco/xterm/DevTools middleware, kernel aliases
├── tsconfig*.json          # strict TypeScript, repo config
└── package.json            # @facilis/ide — a pnpm workspace member
```

## Repo conventions apply here

The IDE is a **workspace member** and is held to the same rules as the framework packages
(AGENTS.md): TypeScript **strict**, the repo **oxlint** config (`-c ../.oxlintrc.json`, the
upstream per-app config was removed), repo **Prettier** (print width 100 — the whole tree was
formatted once when the fork started), vitest tests, and the 300-line limit with one
exception described below. Gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
`pnpm format:check` from the repo root; per-package `pnpm --filter @facilis/ide <script>`.

**300-line ratchet:** fourteen files inherited from upstream are above the limit
(`templates.ts` 11.4k lines of template payloads, `controller.ts` 4.3k, ten components,
`vite.config.ts`). They are recorded in [`scripts/file-length-baseline.json`](../scripts/file-length-baseline.json)
at their import size; the check is a ratchet — a listed file may shrink but not grow, entries
must be deleted once a file drops under 300 lines, and no new file may be added. Splitting them
(staring with `controller.ts`) is the Phase 2 refactor; new IDE code obeys 300 lines immediately.

## Local modifications vs upstream (the complete patch set)

1. `package.json`: name `@facilis/ide` (+ description), repo scripts (`build` = `tsc -b`,
   `build:app` = full `vite build`, `typecheck`, `lint`, `test`), tool versions from the repo
   catalog (TypeScript 7, oxlint, vitest); dropped upstream `bun.lock` and `.oxlintrc.json`.
2. `vite.config.ts`: `@vivari/core` alias -> `../vendor/vivari/packages/core/src/index.ts`;
   dev-server `fs.allow` widened to the repository root (the kernel lives outside this folder).
3. `tsconfig.app.json` / `tsconfig.node.json`: the same `@vivari/core` mapping and
   `"strict": true`.
4. Five deep imports in `src/vv/` (`controller.ts`, `import-remote.ts`,
   `python-language.ts`) point at `../../../vendor/vivari/packages/{kernel-host,runtime}`.
5. Formatting: the tree is formatted with the repo Prettier config (mechanical, no behaviour
   change). Keep it formatted; do not re-run upstream's formatter.
6. Fourteen files above 300 lines, recorded in the file-length baseline (see above).
7. `src/vv/templates.ts`: every Vite template resolves `vite@^7.1.0` instead of upstream's
   `^8.0.0` — Vite 8's rolldown cannot load its wasm binding inside the VM (see "Running it").

Everything else is byte-identical to upstream at the pinned commit (`diff -r` with
`vendor/vivari/packages/studio` shows exactly the files above).

## Running it

The IDE runs on the vendored kernel, so four gitignored build artifacts must exist first.
`docs/DEV.md` is the full guide (why each step exists, versions, troubleshooting); the short
version:

```bash
git submodule update --init vendor/vivari   # once, from the repo root
pnpm install                                # repo install links the IDE (workspace member)

pnpm ide:wasm        # Rust -> Wasm kernel: vendor/vivari/packages/{vfs,codec,crypto}/pkg
pnpm ide:assets      # ide/public/vendor/{npm,pnpm}-pack.bin + sqlite/sqlite3.wasm
pnpm ide:browser     # headless Chromium + libs + fonts (no root, private sysroot)

pnpm ide:dev         # vite dev on 0.0.0.0:5173, COOP/COEP headers
pnpm ide:smoke       # headless acceptance: boot -> create React/TS project -> preview paints
```

Verified 2026-10-25: kernel online **572 ms**, project created, `npm install` inside the VM,
Vite 7 dev server on 5173, preview painted **31 s** — 16/16 smoke checks green (screenshots and
`report.json` under `$FACILIS_TOOLING_DIR/smoke-artifacts/`). `build:app` (full `vite build`)
is not part of that pass yet.

**In-VM constraint (why the templates pin Vite 7):** Vite 8 bundles with rolldown, whose
WebAssembly binding (`@rolldown/binding-wasm32-wasi@1.2.15`) pins `@emnapi/core@2.0.0-alpha.5`,
which `@napi-rs/wasm-runtime@1.2.6` rejects with
`TypeError: Cannot set properties of undefined (setting 'initWorker')`; rolldown's own
"download the binding" fallback re-installs the same broken set, so `vite` never binds a port.
All Vite templates therefore resolve `vite@^7.1.0` (Vite 7.3.7 boots in 259 ms in the same VM).
The `@rolldown/binding-wasm32-wasi` entries are kept so retrying Vite 8 later is a version bump.
Upstream is on it: [rolldown#11292](https://github.com/rolldown/rolldown/pull/11292) (2026-10-25)
moves the binding to `@emnapi/core@2.0.0-beta.2`; Vite depends on `rolldown ~1.2.14`, so the
next rolldown patch release fixes Vite 8 without a Vite bump. An interim per-project
`overrides` pin was verified to boot Vite 8.3.5 (803 ms) — see `docs/DEV.md` §6.1 for the
unblock checklist. Details and the rest of the environment notes: [`docs/DEV.md`](../docs/DEV.md).

## Where Facilis code goes

New Facilis panels and the `IdeController.applyPatch()` write path belong in new modules under
`ide/src/` (writes go through `kernel.writeFiles`, never OPFS directly — SPEC §10.3). Upstream
files are formatted/linted but not otherwise rewritten; forced edits go into the patch set above.
