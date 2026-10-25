# Facilis Studio — vendored Vivari fork: provenance, sync, and verification

This directory is a **vendored fork** of [Vivari](https://github.com/maitrungduc1410/vivari)
that provides the base for **Facilis Studio** (SPEC §10). It is kept as close to upstream
as possible so re-importing a newer upstream stays a mechanical diff, not a merge.

Facilis-specific documentation starts at [README.md](./README.md); upstream documentation
is preserved verbatim as [UPSTREAM-README.md](./UPSTREAM-README.md).

## 1. Provenance

| Fact | Value |
|---|---|
| Upstream repository | <https://github.com/maitrungduc1410/vivari> |
| Upstream branch / tag | `master` (tip of the `release/v1.1.2` merge) |
| **Pinned commit** | `1f00a48c6d8009e7f369c1cf36959d61ad262b19` |
| Commit date | 2026-10-16 13:27:47 +0700 |
| Commit subject | `Merge pull request #15 from maitrungduc1410/release/v1.1.2` |
| Imported into Facilis | 2026-10-25 |
| Import method | `git clone --depth 1 https://github.com/maitrungduc1410/vivari.git` into `/tmp`, then a path-selective copy (no git history, no submodule) |
| License | **MIT** — see [LICENSE](./LICENSE); Copyright (c) 2026 Duc Trung Mai and Vivari contributors |

The full MIT text is vendored unmodified as `studio/LICENSE`. Upstream copyright
headers must not be removed. Facilis code added on top is covered by the repository's root
[LICENSE](../LICENSE) (also MIT).

## 2. What is vendored (and why the whole runtime, not just the IDE)

The Studio is not a self-contained app: it consumes `@vivari/core` from source, and that
SDK bundles the kernel workers and the Rust/Wasm VFS/codec/crypto crates. Keeping the
runtime next to the IDE is what makes `packages/studio` buildable at all.

Concretely: `packages/studio/vite.config.ts` aliases `@vivari/core` to
`../core/src/index.ts`, `packages/studio/src` imports `../../../kernel-host` and
`../../../runtime` directly, and `packages/core/src/workers/*` imports
`../../../{vfs,codec,crypto}/pkg`. There is no standalone `studio` package upstream — only
the kernel is published on npm (`@vivari/core@1.1.2`).

The whole fork is **601 files / ~13 MB** (excluding `node_modules` and build output):
`packages/runtime` 5.7 MB (vendored Node/Python binaries), `scripts/` 3.9 MB (in-browser
npm/pnpm vendoring harnesses), `packages/studio` ~1.9 MB of source, the rest of the kernel
~1.3 MB. It is vendored as a unit on purpose: a partial copy cannot build or run, and a
path-by-path upstream sync is the cheapest maintenance model for a fork we will patch.

### Could the fork be smaller?

Yes, one variant exists and was evaluated: depend on the published `@vivari/core@1.1.2`
(27 files, ~7.7 MB unpacked, no `.wasm` files) from npm instead of vendoring the kernel source.
It would leave only `packages/studio` (~2 MB) in `studio/` and remove the local Rust/`wasm-pack`
build requirement, at the cost of (a) changing the upstream vite alias, (b) losing the ability to
patch the kernel in-tree, and (c) depending on upstream's release cadence for kernel fixes.
Deferred: the fork is vendored for fidelity now; revisit if/when we need to build the Studio
in an environment without Rust, which is exactly what blocks `vite build` today (section 7).

| Path | Upstream content | Why vendored |
|---|---|---|
| `packages/studio/` | The VS Code-style IDE (Vite 8 + React 19 + Tailwind v4 + shadcn/Base UI, Monaco, xterm) — the actual fork base | The fork surface for Facilis Studio |
| `packages/core/` | `@vivari/core` SDK: `KernelBridge`, workers, boot | `packages/studio` aliases `@vivari/core` to `../core/src/index.ts` |
| `packages/react/` | `@vivari/react` bindings | Part of the SDK pair; consumed by examples |
| `packages/runtime/`, `packages/kernel-host/`, `packages/protocol/` | Node runtime shim + kernel + syscall protocol | Required by `@vivari/core` workers |
| `packages/vfs/`, `packages/codec/`, `packages/crypto/`, `packages/wasi-demo/` | Rust crates compiled to Wasm with `wasm-pack` | Required by the kernel; source only (no built `pkg/`) |
| `scripts/` | Vendor/verify/smoke/spike harnesses (173 files) | Needed to vendor npm/yarn/pnpm, sqlite, pyodide, etc. |
| `worker/` | Cloudflare Worker for wildcard preview origins (mode C) | Referenced by the studio preview/SW architecture |
| `examples/basic/` | Minimal `@vivari/core` example | Runnable reference and SDK smoke surface |
| `package.json`, `package-lock.json` | Upstream root npm-workspace manifest + lock | Documents the intended upstream toolchain/workspace list |
| `.nvmrc` | `22` | Matches Facilis' Node >= 22.15 floor |
| `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` | Upstream legal/community files | MIT attribution + upstream contribution rules retained |
| `icon.svg` | Upstream project icon | Kept as upstream brand asset (not yet replaced) |
| `UPSTREAM-README.md` | Upstream `README.md`, byte-identical | Keeps upstream docs for reference; `studio/README.md` is Facilis-owned |
| `.gitignore` | Upstream root `.gitignore` content | Build outputs (`pkg/`, `vendor/`, `dist/`, `target/`) stay out of git; leading-`/` patterns stay valid at the `studio/` root |
| `packages/runtime/vendor/sqlite/sqlite3.wasm`, `scripts/fixtures/napi-crc32/crc32.wasm32-wasi.wasm` | Upstream-committed binary assets at the pinned commit (official sqlite.org Wasm build; an N-API crc32 test fixture) | Vendored for fork fidelity: they already exist upstream, so they stay part of the tree (sha256-verified against upstream). Facilis policy forbids **new** binary artifacts; it does not strip files upstream already commits. |

## 3. What is excluded, and why

| Excluded | Reason |
|---|---|
| `.git/` | Vendored copy, not a submodule; history lives in the Facilis repo. Keeping it would embed a second repo inside the tree. |
| `.github/` | Upstream CI/release workflows are specific to publishing `@vivari/*`; Facilis CI lives at the repository root. |
| `.changeset/` | Upstream changesets/release automation; Facilis does not publish these packages. |
| `sites/` (~2.4 MB) | Upstream landing/docs/blog/embed sites; not part of the Studio. Facilis docs live in `docs/` at the repo root. |
| `README.md` (as `studio/README.md`) | Renamed to `UPSTREAM-README.md`; `studio/README.md` is Facilis-owned. A sync must not restore the upstream name. |
| `AGENTS.md` (436 KB), `ARCHITECTURE.md` (185 KB), `research.md` (18 KB), `roadmap.md` (880 KB) | Upstream planning/architecture documents; not needed to run the Studio and huge in the tree. Read them upstream at the pinned commit when needed. |
| `node_modules/` | Never present in a fresh clone; verification installs it locally and gitignored. |
| `.DS_Store` (2 files) | macOS metadata. |
| Built Rust/Wasm outputs (`packages/{vfs,codec,crypto}/pkg*/`, `packages/wasi-demo/pkg/`, `target/`) and `packages/studio/public/vendor/` | Gitignored upstream; generated by `npm run build` / `npm run vendor:*`. Not committed here by design — new `.wasm` build outputs would violate the no-new-binaries policy (the two upstream-committed `.wasm` files are vendored; see section 2). |

## 4. Local modifications (the complete list)

Only these differ from upstream at the pinned commit — verified by an automated
file-by-file comparison against a fresh clone:

1. `studio/package.json` — `"name": "vivari"` to `"name": "facilis-studio"`. **All
   other fields byte-identical** (including `private`, `workspaces`, `scripts`, versions).
2. `studio/packages/studio/package.json` — `"name": "studio"` to
   `"name": "@facilis-studio/app"`. **All other fields byte-identical.**
3. `studio/.gitignore` — the upstream content with a 2-line provenance header prepended
   and a trailing newline added (upstream file has none).
4. `studio/README.md` and `studio/FACILIS.md` — new Facilis docs (this file).

Everything else (`packages/`, `scripts/`, `worker/`, `examples/basic/`, `LICENSE`,
`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `icon.svg`, `UPSTREAM-README.md`,
`package-lock.json`, `.nvmrc`, and the two upstream-committed `.wasm` binaries under
`packages/runtime/vendor/sqlite/` and `scripts/fixtures/napi-crc32/`) is byte-identical to
upstream (the `.wasm` files were restored from upstream and are sha256-verified). **Do not
rewrite upstream source files**; Facilis features belong in new modules (SPEC §10.2).

On upstream sync, re-run the same comparison and keep this section truthful. Any forced
edit to an upstream file must be appended here with its reason.

## 5. Upstream sync procedure

Precondition: an empty scratch clone (never inside `studio/`).

    git clone --depth 1 https://github.com/maitrungduc1410/vivari.git /tmp/vivari-upstream
    git -C /tmp/vivari-upstream rev-parse HEAD   # record the new SHA; update section 1

1. **Diff before copying.** Compare `/tmp/vivari-upstream` with `studio/` using the
   selection/exclusion rules in sections 2-3. Expect exactly the modifications listed in
   section 4 (plus Facilis modules added over time).
2. **Re-import selectively.** Copy the selected paths; exclude everything in section 3.
   Keep `studio/README.md` and `studio/FACILIS.md` (do not overwrite them with upstream
   `README.md`), and regenerate `UPSTREAM-README.md` from the new upstream `README.md`.
   Recreate `studio/.gitignore` from the new upstream root `.gitignore` plus the
   provenance header.
3. **Re-apply the two name edits** in section 4 (the only upstream-file changes).
4. **Update this file:** new commit SHA/date/subject in section 1, new file count in
   section 8, and the verification results (repeat section 7 where the environment allows).
5. **Keep Facilis changes isolated.** New panels live in new modules
   (`ChatPanel`, `ApiFlowPanel`, `DataExplorerPanel`, `ReleasePreviewPanel` — SPEC §10.2),
   wired through `IdeController.applyPatch()` and `kernel.writeFiles` (SPEC §10.3), so the
   next upstream diff does not collide with them.
6. **Re-run hygiene gates** from the repo root: `node scripts/check-file-length.mjs`
   (skips `studio/`), `pnpm exec oxlint . --quiet` (ignores `studio/**`), and
   `git status --short` to confirm only intended changes.

The Facilis repo already excludes `studio/` from the shared gates — it is upstream code
whose files routinely exceed 300 lines (e.g. `packages/studio/src/vv/controller.ts`,
`packages/core/src/workers/kernel-worker.ts`) and whose formatting is upstream's:
`scripts/check-file-length.mjs` ignores the `studio` path segment, `.oxlintrc.json` has
`studio/**` in `ignorePatterns`, and `.prettierignore` lists `studio/`.

## 6. Runtime model inside the fork (SPEC §10.6)

**There is one dev process, not two.** When a generated Facilis project boots inside
Vivari, the user runs `vite dev`; Nitro v3 is mounted **as a Vite plugin inside it**,
not started as a second server and never via `nitro dev`.

- Vite serves the React client (HMR) and, through the `nitro()` plugin, the server routes
  (`/api/*`), OpenAPI generation and the dev-only `/__facilis/*` endpoints — **one
  origin, one port**.
- The preview iframe points at that Vite origin, so client and `/api/*` are same-origin;
  no reverse proxy between two ports.
- Nitro's worker reloads on edits under `server/`; Vite HMR fires on client edits.
- `/__facilis/manifest` and `/_openapi.json` are reachable from the preview iframe's
  origin. PGlite (a separate WASM instance) boots inside the Nitro worker; the Studio does
  not manage it.
- If the Vite process dies, the Studio restarts `vite dev`. There is no Nitro process to
  restart.
- Facilis adds its own `facilis()` Vite plugin **before** `nitro()` (SPEC §5.6 / Appendix E);
  the Studio consumes its manifest/OpenAPI endpoints, not Nitro's internals.

Upstream Studio today runs its own demo flow (`VV_RUN`) and local-only git over its VFS.
Facilis replaces/extends that in Phase 2 (SPEC §10.2): AI Chat, API Visualizer, Entity
Explorer, Release Preview, project switcher, PAT auth. None of those exist yet — the tree
is vendored but unmodified for Facilis.

## 7. Verification in this sandbox (2026-10-25)

Environment actually available:

| Tool | Status |
|---|---|
| Node | **24.22.1** (satisfies upstream `>=22.15`) |
| pnpm | **12.15.0** |
| `bun` | **MISSING** — upstream Studio's `dev`/`build` scripts are Bun scripts |
| `npm` | **MISSING** — upstream root scripts and `predev` vendor scripts assume npm |
| `cargo`, `rustc`, `wasm-pack` | **MISSING** — Rust crates cannot be built, so no `packages/*/pkg` Wasm |
| `wrangler` | **MISSING** |
| Browser / Chromium / Playwright | **MISSING** — no browser harness at all |
| Network to npm registry | available (install downloaded packages) |

Commands attempted from `studio/packages/studio` (standalone; the repo root workspace
does **not** include `studio/`):

    pnpm install --ignore-workspace
    # -> 597 packages added, but EXIT 1:
    #    ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: core-js@3.51.0
    #    (pnpm 12 blocks unapproved dependency build scripts; correct for arbitrary
    #     upstream deps. The deps are still materialized, so tsc/vite can run.)

    pnpm install --ignore-workspace --config.strict-dep-builds=false
    # -> "Already up to date", EXIT 0  (same dependency set; only pnpm's strict
    #    build-script gate disabled for this verification install)

    pnpm exec tsc -p tsconfig.app.json --noEmit
    # -> EXIT 0, 756 files in the program (8 from packages/core/src)
    #    NOTE: shallow pass. The kernel/fs/fetcher/process workers are loaded with
    #    new Worker(new URL(...)), which tsc does not traverse, so the
    #    wasm-importing files are not type-checked. It does not prove the Studio is
    #    buildable or bootable.

    pnpm exec vite build
    # -> EXIT 1 after 3.3 s, 1973 modules transformed:
    #    [UNRESOLVED_IMPORT] Could not resolve '../../../vfs/pkg/vivari_vfs.js'
    #      in ../core/src/workers/fs-worker.ts
    #    plus: new URL("../../../vfs/pkg/vivari_vfs_bg.wasm", import.meta.url)
    #    doesn't exist at build time

**Interpretation of the build failure:** it is not a defect in the vendored tree and not
caused by the exclusions. `packages/{vfs,codec,crypto}/pkg` are Rust-to-Wasm outputs that
are gitignored upstream and must be generated with `wasm-pack` (which in turn needs a
Rust toolchain). Both are absent here, so `@vivari/core` workers cannot resolve their
Wasm imports. Generating them, then re-running `vite build`, is the next verification
step for an environment that has Rust + `wasm-pack`.

**Not attempted (blocked, with exact prerequisites):**

| Action | Blocked by |
|---|---|
| `pnpm build` / upstream `npm run build:studio` / `bun run dev` / `bun run build` | `bun` and `npm` absent; `wasm-pack` + `cargo` absent for the Rust `pkg` outputs. Upstream Studio scripts invoke Bun directly; its own `build` is `tsc -b && vite build`. |
| Upstream root `npm run dev` / `predev` vendor scripts (`vendor:npm`, `vendor:pyodide`, `vendor:sqlite`, `vendor:locks`, ...) | `npm` absent; they write large vendor trees and fetch toolchains. Not needed to vendor the source. |
| `npm run build` (Rust Wasm: vfs/codec/crypto/wasi-demo) | `cargo` / `wasm-pack` absent; generated `.wasm` build outputs are not committed (no-new-binaries policy). |
| Browser/WebContainer behaviour (Phase 0 tickets A2, A3, A6, A8-A12; Studio IDE, `vite dev` in the WebContainer, HMR, isomorphic-git on the VFS, OPFS persistence, PAT clone, COOP/COEP `SharedArrayBuffer`, preview Service Worker) | No browser, no WebContainer, no OPFS, no `SharedArrayBuffer` in this Node-only sandbox. Must be validated in a browser harness, not here. |
| `worker/` deployment / wildcard preview origins | `wrangler` absent, Cloudflare account/zone not available. |
| `sites/` build/deploy | Intentionally excluded from the fork (section 3); upstream `scripts/cloudflare-build*.sh` therefore cannot run from here either. |
| `examples/basic` build | Depends on the same missing SDK Wasm outputs and browser APIs. |

**Verdict:** provenance and tree integrity are fully verified, and the Studio's Vite dev
server boots and serves the shell/UI modules headlessly (see Appendix A). It still
**cannot run its WebContainer kernel or produce a production build** here — the Rust/Wasm
`pkg/` outputs are missing and there is no browser — so no browser-level Phase 0 ticket
(A2/A3/A6/A8-A12) can be cleared in this sandbox. What can be verified without a browser is
verified above.

## 8. Disk/file-count record

| Metric | Before import | After import + docs | Notes |
|---|---|---|---|
| Files inside `studio/` | 0 | **601** | tracked candidates; see arithmetic below |
| `studio/` on-disk size (tracked tree) | 0 | **~14 MB** | gitignored `node_modules` not included |
| Repo tracked-file count | 73 | 73 + 601 | `git status` shows them as untracked additions (not committed) |
| Verification-only, gitignored | - | `packages/studio/node_modules` (~385 MB apparent; hard-linked from the repo-local pnpm store) | created by `pnpm install --ignore-workspace`; removable with `rm -rf packages/studio/node_modules` |

Selected upstream files: `packages/`, `scripts/`, `worker/`, `examples/basic`, the eight
upstream root files (`package.json`, `package-lock.json`, `.nvmrc`, `LICENSE`,
`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `icon.svg`), `README.md` and
`.gitignore`. Only the 2 `.DS_Store` files are dropped, so all 599 upstream files (including
the 2 upstream-committed `.wasm` binaries) are vendored. Upstream `README.md` is stored as
`UPSTREAM-README.md` and the recreated `.gitignore` is one of the 599; adding the new
`README.md` and new `FACILIS.md` gives the 601 total.

The temporary `pnpm-lock.yaml` and partial `dist/` produced by the verification build were
removed after the runs so the tree stays upstream-shaped and `git status` stays clean.

## Appendix A — Headless Studio dev-server smoke (2026-10-25)

Timeboxed check after the import. Run from `studio/packages/studio`:

    pnpm exec vite dev --host 127.0.0.1 --port 5310 --strictPort    # killed after the probes

Result: **Vite dev boots in 187 ms and serves the Studio shell/UI modules; the WebContainer
worker modules fail to transform because the Rust Wasm `pkg/` outputs are missing.**

| Request | HTTP | Result |
|---|---|---|
| `GET /` | **200** | HTML shell (react-refresh + `/@vite/client` + `/src/main.tsx` boot script); response headers include `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, `Cache-Control: no-cache` |
| `GET /src/main.tsx` | **200** | transformed ESM; React/react-dom/next-themes resolve from `node_modules/.vite/deps/*` |
| `GET /vite.config.ts` | **200** | served as a module by the dev server |
| `GET /src/vv/kernel.ts` | **200** | re-export rewritten to `/@fs/.../studio/packages/core/src/index.ts` (the `@vivari/core` source alias resolves) |
| `GET /@fs/.../core/src/workers/kernel-worker.ts?worker_file&type=module` | **200** | transforms; its Wasm/codec imports are dynamic/runtime, not top-level |
| `GET /@fs/.../core/src/workers/fs-worker.ts?worker_file&type=module` | **500** | `Failed to resolve import "../../../vfs/pkg/vivari_vfs.js" from "../core/src/workers/fs-worker.ts?worker_file&type=module"` |
| `GET /@fs/.../core/src/workers/process-worker.ts?worker_file&type=module` | **500** | `Failed to resolve import "../../../codec/pkg/vivari_codec.js"` (and `crypto/pkg/vivari_crypto.js`) |

So the missing `packages/{vfs,codec,crypto}/pkg` outputs block the **transform stage of the
kernel worker graph**, not just runtime: the shell and UI modules are served, but when the app
requests the WebContainer workers Vite answers 500 with "Failed to resolve import" (in a
browser that is the error overlay / failed boot, not a silently degraded UI). `GET /` and
`GET /src/main.tsx` kept returning 200 after those failures and the dev server did not crash;
after killing it port 5310 was free.

Unrelated environment quirk seen once during the smoke (not caused by the missing Wasm):
Vite's dependency optimizer logged
`UNLOADABLE_DEPENDENCY ... @tailwindcss/oxide-linux-x64-gnu/tailwindcss-oxide.linux-x64-gnu.node
... stream did not contain valid UTF-8` while discovering a new dependency; that `.node` file
is a valid ELF x86-64 shared object and subsequent requests stayed 200. Re-check with a clean
store/native toolchain before attributing it to the Studio.

## Appendix B — What a browser harness would still need

1. Chromium via Playwright (installable from npm; **not attempted here**), pointed at the dev
   server on a free port; COOP/COEP headers are already sent (verified above).
2. A cross-origin-isolated page with `SharedArrayBuffer`, OPFS and Service Worker support —
   absent in this Node-only sandbox, so kernel boot, HMR, VFS/isomorphic-git and preview are
   untestable here.
3. Rust + `wasm-pack` to build `packages/{vfs,codec,crypto}/pkg` (and `wasi-demo`); without
   them the worker transforms above keep returning 500.
4. `bun` (or `npm`) only if the upstream root scripts / vendor pipeline are exercised; `pnpm`
   alone covered install, typecheck and the dev server here.
5. No browser installs, network vendor fetches or OPFS seeding were attempted in this sandbox.

