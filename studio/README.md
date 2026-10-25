# Facilis Studio

Facilis Studio is the browser IDE for Facilis: a VS Code-style app that runs a generated
Facilis project inside a WebContainer, where `vite dev` is the single dev server and
**Nitro v3 runs as a Vite plugin** (SPEC §10.6).

**Status: forked, not yet extended with Facilis panels.** This directory is the app — an
MIT-licensed fork of upstream Vivari's `packages/studio`. The upstream **kernel** it runs
on (Node/Bun/Python runtime, VFS/codec/crypto crates, in-browser npm) is vendored next to it
at [`vendor/vivari/`](../vendor/vivari) and is never edited. Keeping the app and the kernel
in separate trees is what makes ownership obvious: `studio/` is ours, `vendor/` is upstream.

| | |
|---|---|
| Upstream repository | <https://github.com/maitrungduc1410/vivari> |
| Pinned commit | `1f00a48c6d8009e7f369c1cf36959d61ad262b19` (branch `master`, 2026-10-16) |
| App source | upstream `packages/studio/` |
| Kernel sources | [`vendor/vivari/`](../vendor/vivari) — provenance, patch set and sync procedure in [`vendor/vivari/FACILIS.md`](../vendor/vivari/FACILIS.md) |
| License | MIT — [`LICENSE`](./LICENSE) (Copyright (c) 2026 Duc Trung Mai and Vivari contributors); Facilis code is covered by the root [`LICENSE`](../LICENSE) |

## Layout

```
studio/                     # this app — the fork surface
├── src/                    # editor UI, IdeController (src/vv), panels
├── public/                 # static assets (SW, devtools shims)
├── index.html
├── vite.config.ts          # COOP/COEP, Monaco/xterm/DevTools middleware, kernel aliases
├── tsconfig*.json
└── package.json            # @facilis/studio — own dependency tree, NOT a workspace member
```

The app is intentionally **not** a pnpm-workspace member: it has its own React/Monaco/xterm
dependency tree and is excluded from the root lint/format/file-length gates like
`vendor/`. Install it separately (`pnpm install --ignore-workspace` inside this directory).

## Local modifications vs upstream (the complete patch set)

Only these differ from upstream `packages/studio` — everything else is byte-identical so
re-syncing upstream stays mechanical:

1. `package.json`: name `studio` -> `@facilis/studio` (+ description); dropped upstream
   `bun.lock` (we use pnpm).
2. `vite.config.ts`: `@vivari/core` alias points at
   `../vendor/vivari/packages/core/src/index.ts`; dev-server `fs.allow` widened to the
   repository root (the kernel lives outside this directory).
3. `tsconfig.app.json`: the same `@vivari/core` path mapping.
4. Five deep imports in `src/vv/` (`controller.ts`, `import-remote.ts`,
   `python-language.ts`) point at `../../../vendor/vivari/packages/{kernel-host,runtime}`.

Re-apply (and extend) this list when syncing upstream; the procedure is in
[`vendor/vivari/FACILIS.md`](../vendor/vivari/FACILIS.md#6-upstream-sync-procedure).

## Running it

```bash
cd studio
pnpm install --ignore-workspace   # own toolchain; not part of the repo workspace
pnpm dev                          # vite dev, COOP/COEP headers, :5173 by default
```

**Sandbox limits (2026-10-25):** the dev server serves the shell (`/` 200, `/src/main.tsx`
200, COOP/COEP present, `@vivari/core` resolves) and the app typechecks
(`tsc -p tsconfig.app.json --noEmit` exit 0), but the **WebContainer cannot boot**:
`vendor/vivari/packages/{vfs,codec,crypto}/pkg` are Rust->Wasm output that needs
`cargo`/`wasm-pack` (absent here), so `vite build` and the worker graph fail to resolve
them. A real browser harness (Chromium + SharedArrayBuffer/OPFS) plus the Rust toolchain is
required to clear Phase 0 items A1-A3/A6/A8-A12. Full matrix:
[`vendor/vivari/FACILIS.md`](../vendor/vivari/FACILIS.md#7-verification-in-this-sandbox-2026-10-25).

## Where Facilis code goes

New Facilis panels and the `IdeController.applyPatch()` write path belong in new modules
under `studio/src/` (writes go through `kernel.writeFiles`, never OPFS directly — SPEC
§10.3), not in rewrites of upstream files. If a forced edit to an upstream file is needed,
add it to the patch set above and to `vendor/vivari/FACILIS.md`.
