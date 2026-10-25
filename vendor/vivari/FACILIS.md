# Vendored Vivari kernel — provenance, patch set and upstream sync

This directory holds the **pinned upstream Vivari sources** that the Facilis Studio app runs
on: the WebContainer kernel (Node/Bun/Python runtime, syscall protocol, Rust->Wasm VFS, codec
and crypto crates), the in-browser package-manager vendoring harnesses, the preview worker and
one example.

It is **upstream code**: treat it as read-only. Facilis code lives in `../../packages/`
(framework) and `../../studio/` (the IDE app), never here. The app is kept in its own tree so
ownership is unambiguous: `studio/` is ours to edit, `vendor/` is a pinned third-party copy.

## 1. Provenance

| Fact | Value |
|---|---|
| Upstream repository | <https://github.com/maitrungduc1410/vivari> |
| Branch / tip | `master` (tip of the `release/v1.1.2` merge) |
| **Pinned commit** | `1f00a48c6d8009e7f369c1cf36959d61ad262b19` |
| Commit date | 2026-10-16 13:27:47 +0700 |
| Commit subject | `Merge pull request #15 from maitrungduc1410/release/v1.1.2` |
| Imported into Facilis | 2026-10-25 |
| Import method | `git clone --depth 1` into `/tmp`, path-selective copy (no git history, no submodule) |
| License | **MIT** — [`LICENSE`](./LICENSE), Copyright (c) 2026 Duc Trung Mai and Vivari contributors |

The MIT text is vendored unmodified. Facilis code added on top is covered by the repository
root [`LICENSE`](../../LICENSE) (also MIT).

## 2. What is vendored (and why the kernel, not just the app)

The Studio is not self-contained: `studio/vite.config.ts` aliases `@vivari/core` to
`vendor/vivari/packages/core/src/index.ts`, `studio/src` imports `kernel-host` and
`runtime` directly, and `packages/core/src/workers/*` imports
`../../../{vfs,codec,crypto}/pkg`. Without the kernel next to the app, nothing builds.

| Path | Upstream content | Why kept |
|---|---|---|
| `packages/core/` | `@vivari/core` SDK: `KernelBridge`, workers, boot | The app aliases it from source |
| `packages/kernel-host/`, `packages/runtime/`, `packages/protocol/` | Node runtime shim, kernel host, syscall protocol, vendored Node/Python binaries (5.7 MB) | Required by the core workers |
| `packages/vfs/`, `packages/codec/`, `packages/crypto/`, `packages/wasi-demo/` | Rust crates compiled to Wasm with `wasm-pack` | Required by the kernel; source only (no built `pkg/`) |
| `packages/react/` | `@vivari/react` bindings | Part of the upstream SDK, kept for the sync boundary |
| `scripts/` | Vendor/verify/smoke harnesses (in-browser npm/yarn/pnpm/corepack, pyodide, ruff, sqlite) | Needed to produce the runtime assets the WebContainer serves |
| `worker/` | Cloudflare Worker for wildcard preview origins | Referenced by the preview/Service-Worker architecture |
| `examples/basic/` | Minimal `@vivari/core` example | Runnable SDK reference |
| `package.json`, `package-lock.json` | Upstream root npm-workspace manifest + lock | Documents the intended upstream toolchain (name restored to upstream `vivari`; this tree is **not** a pnpm-workspace member) |
| `.gitignore`, `.nvmrc` | Upstream root files | Build outputs stay out of git; Node 22 matches the Facilis floor |
| `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `icon.svg` | Upstream legal/community/brand files | MIT attribution + upstream contribution rules |
| `README.md`, `UPSTREAM-STUDIO-README.md` | Upstream remote-wide README and the Studio's README | Reference copies of the upstream docs |
| `packages/runtime/vendor/sqlite/sqlite3.wasm`, `scripts/fixtures/napi-crc32/crc32.wasm32-wasi.wasm` | Upstream-committed binary assets (official sqlite.org Wasm build, N-API crc32 test fixture) | Fork fidelity: they exist upstream, so they stay (sha256-identical) |

The Studio app itself was **moved out** of `packages/studio/` into `../../studio/`: it is the
fork surface, and it carries a small, documented patch set (see `../../studio/README.md`).

## 3. Excluded upstream paths, and why

| Excluded | Reason |
|---|---|
| `.git/` | Vendored copy, not a submodule; history lives in the Facilis repository |
| `.github/`, `.changeset/` | Upstream CI/release automation for publishing `@vivari/*`; Facilis CI lives at the repo root |
| `sites/` (~2.4 MB) | Upstream landing/docs/blog/embed sites; Facilis docs live in `docs/` |
| `AGENTS.md` (436 KB), `ARCHITECTURE.md` (185 KB), `research.md`, `roadmap.md` (880 KB) | Upstream planning documents, huge in the tree and not needed to run the Studio; read them upstream at the pinned commit |
| `node_modules/`, built React/Wasm outputs (`packages/*/pkg*/`, `target/`, `packages/studio/public/vendor/`) | Gitignored upstream; produced by `npm run build` / `npm run vendor:*` |
| `.DS_Store` | macOS metadata |
| `packages/studio/` | Moved to `../../studio/` (the app we fork), see section 5 |

## 4. Local modifications in this tree

None to upstream file **content**. The root `package.json` keeps the upstream `name` (`vivari`);
it briefly carried a Facilis name while the whole repository was vendored as one tree, and that
rename now applies to the app's own manifest in `../../studio/package.json`. Deviations are
*structural only*: `packages/studio/` is absent (moved out) and the upstream-committed
`.wasm` fixtures are kept for fidelity.

## 5. The app's patch set (applies to `../../studio/`, not here)

The Studio app differs from upstream `packages/studio` in exactly these places, mirrored in
`../../studio/README.md`:

1. `package.json`: name `studio` -> `@facilis/studio`, plus a description; `bun.lock` dropped
   (Facilis uses pnpm).
2. `vite.config.ts`: `@vivari/core` alias -> this tree's `packages/core/src/index.ts`;
   dev-server `fs.allow` widened to the repository root.
3. `tsconfig.app.json`: the same `@vivari/core` path mapping.
4. Five deep imports in `studio/src/vv/` -> `../../../vendor/vivari/packages/{kernel-host,runtime}`.

## 6. Upstream sync procedure

```bash
# 1. fetch upstream at a new pinned commit
git clone --depth 1 https://github.com/maitrungduc1410/vivari.git /tmp/vivari-next
git -C /tmp/vivari-next rev-parse HEAD          # record this as the new pin

# 2. re-import the kernel (same path list as section 2)
rm -rf vendor/vivari/packages vendor/vivari/scripts vendor/vivari/worker vendor/vivari/examples
cp -R /tmp/vivari-next/packages/{core,kernel-host,runtime,protocol,vfs,codec,crypto,react,wasi-demo} vendor/vivari/packages/
cp -R /tmp/vivari-next/scripts vendor/vivari/scripts
cp -R /tmp/vivari-next/worker vendor/vivari/worker
cp -R /tmp/vivari-next/examples/basic vendor/vivari/examples/basic
cp /tmp/vivari-next/{package.json,package-lock.json,.gitignore,.nvmrc,LICENSE,CONTRIBUTING.md,CODE_OF_CONDUCT.md,SECURITY.md,icon.svg} vendor/vivari/
cp /tmp/vivari-next/README.md vendor/vivari/README.md
cp /tmp/vivari-next/packages/studio/README.md vendor/vivari/UPSTREAM-STUDIO-README.md

# 3. re-import the app, then re-apply the patch set of section 5 (git diff shows them)
rsync -a --delete --exclude node_modules --exclude dist /tmp/vivari-next/packages/studio/ studio/
```

Diff against the upstream clone to confirm only the section-5 patch set remains
(`diff -r` on `vendor/vivari/packages/*` must be empty; `studio/` must show exactly the
patched files plus `README.md`, `LICENSE` and the two Facilis docs). Update the pinned commit
in this file and in `../../studio/README.md`, then re-run the root gates plus the Studio checks
in section 7.

## 7. Verification in this sandbox (2026-10-25)

| Check | Result |
|---|---|
| Root gates (lint / typecheck / test / build / format / file-length) | **pass**; this tree is excluded from all of them (`studio`, `vendor` path segments) |
| `cd studio && pnpm install --ignore-workspace` | exit 0 (661 packages) |
| `pnpm exec tsc -p tsconfig.app.json --noEmit` | **exit 0** (756 files) |
| `pnpm exec vite dev --host 127.0.0.1 --port 5231` | ready in 278 ms; `/` 200, `/src/main.tsx` 200, `/vite.config.ts` 200, `@vivari/core` alias 200; COOP `same-origin` + COEP `require-corp` present |
| `pnpm exec vite build` | **fails**: `Could not resolve '../../../vfs/pkg/vivari_vfs.js'` — `packages/{vfs,codec,crypto}/pkg` are Rust->Wasm outputs; `cargo`/`wasm-pack` absent. Not caused by the vendoring |
| Browser/WebContainer behaviour (VFS, HMR through the kernel, OPFS mirror, in-browser npm) | **blocked**: no Chromium, no cross-origin-isolated page, no Rust toolchain |

Known unrelated dev-only quirk: Vite's dependency optimizer reports
`UNLOADABLE_DEPENDENCY` for the `@tailwindcss/oxide` native `.node` file
(`stream did not contain valid UTF-8`) even though it is a valid ELF binary; requests still
succeed. Upstream behaviour, recorded so it is not mistaken for a vendoring bug.

## 8. Size

500 files / ~11 MB tracked (excluding `node_modules`): `packages/runtime` 5.7 MB (vendored
Node/Python binaries), `scripts/` 3.9 MB, the rest of the kernel ~1.4 MB. The app adds
~1.8 MB / 100 files under `../../studio/`.

### Could the fork be smaller?

Yes, one variant was evaluated: depend on the published `@vivari/core@1.1.2` (27 files, ~7.7 MB
unpacked) instead of vendoring the kernel sources. That would leave only the app (~1.8 MB) and
remove the local Rust build requirement, at the cost of changing the upstream vite alias, losing
the ability to patch the kernel in-tree, and handing kernel fixes to upstream's release cadence.
Deferred: the kernel is vendored for fidelity; revisit if the Studio must build in an environment
without Rust (which is what blocks `vite build` today).
