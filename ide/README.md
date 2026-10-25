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

Everything else is byte-identical to upstream at the pinned commit (`diff -r` with
`vendor/vivari/packages/studio` shows exactly the files above).

## Running it

```bash
git submodule update --init vendor/vivari   # once, from the repo root
pnpm install                                # repo install links the IDE (workspace member)
cd ide
pnpm dev                                    # vite dev, COOP/COEP headers
```

**Sandbox limits (2026-10-25):** the dev server serves the shell (`/` 200, `/src/main.tsx`
200, COOP/COEP present) and the app typechecks strictly (756 files, 0 errors), but the
**WebContainer cannot boot**: `vendor/vivari/packages/{vfs,codec,crypto}/pkg` are Rust->Wasm
outputs that need `cargo`/`wasm-pack` (absent here), so `build:app` and the worker graph fail
to resolve them. A real browser harness (Chromium + SharedArrayBuffer/OPFS) plus the Rust
toolchain is required to clear Phase 0 items A1-A3/A6/A8-A12. Details:
[`vendor/README.md`](../vendor/README.md).

## Where Facilis code goes

New Facilis panels and the `IdeController.applyPatch()` write path belong in new modules under
`ide/src/` (writes go through `kernel.writeFiles`, never OPFS directly — SPEC §10.3). Upstream
files are formatted/linted but not otherwise rewritten; forced edits go into the patch set above.
