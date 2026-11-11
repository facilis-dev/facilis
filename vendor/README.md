# vendor/ — the pinned Vivari fork (git submodule)

`vendor/vivari/` is a git submodule of **our fork**,
[`github.com/kele23/vivari`](https://github.com/kele23/vivari) (MIT; upstream
[maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari)), pinned in `.gitmodules`
(`branch = facilis/main`; the pin itself is the gitlink commit, so a checkout is reproducible).

Why a fork and not the upstream tag (D-030): upstream defects the IDE depends on are fixed in
`facilis/main` — see the fork's `FORK.md`. Pinning the fork means
the product, CI and the smoke harness all execute the code this repo asserts, instead of an
unpatched upstream release. The **worktree is never edited**: every change is a commit on a
branch in the fork, so `git -C vendor/vivari status` stays clean by construction, and each fix
is also its own branch to propose upstream as a PR.

| Piece | Where |
|---|---|
| Our fork | `https://github.com/kele23/vivari` — `master` mirrors upstream, `facilis/main` is what we pin |
| Upstream releases | second remote `upstream` in the same clone: `git -C vendor/vivari fetch upstream --tags` |
| Branch map + workflow | `vendor/vivari/FORK.md` (in the fork) + this file |
| Facilis code that uses it | `packages/` (`@facilis.dev/*`) and `ide/` (fork of upstream `packages/studio`) |

## First checkout

```bash
git submodule update --init vendor/vivari   # or: --init --recursive
```

Without it, `vendor/vivari/` is empty and the IDE cannot typecheck or build (its
`@vivari/core` alias points into this tree).

## Update the engine

1. In the fork: rebase the `fix/*` branches onto the new upstream tag, force-push
   `facilis/main`.
2. Here:

```bash
git -C vendor/vivari fetch origin
git -C vendor/vivari checkout <facilis/main sha>   # never a branch head
git add vendor/vivari                              # only the gitlink changes
git commit -m "chore(vendor): bump vivari fork to <sha>"
```

`git status` shows a single changed pointer, not 500 files. Fetching upstream releases is the
fork's job; the pin never moves on its own. A fresh clone has the fork as `origin`, so add the
upstream remote once:

```bash
git -C vendor/vivari remote add upstream https://github.com/maitrungduc1410/vivari.git
git -C vendor/vivari fetch upstream --tags
```

## What the IDE consumes from here

- `packages/core` — aliased from source (`@vivari/core`), brings the kernel workers
- `packages/kernel-host`, `packages/runtime`, `packages/protocol` — runtime shims + vendored binaries
- `packages/{vfs,codec,crypto}` — Rust->Wasm crates; `pkg/` is built with `wasm-pack` (not
  committed upstream, not present in this sandbox)
- `scripts/`, `worker/`, `examples/basic` — available for later phases (asset vendoring, preview worker)

The full upstream tree is present (including upstream docs) because it is a real clone; our
gates ignore `vendor/` entirely.

## Sync checklist after a bump

1. `pnpm ide:smoke` and `TEMPLATE=Facilis pnpm ide:smoke` — the engine is only green when the
   browser path is; plus the `facilis.home` proxy smoke in [`docs/DEV.md`](../docs/DEV.md)
   when the proxy is part of the change.
2. `diff -r vendor/vivari/packages/studio ide` — the only differences must be the IDE patch
   set documented in [`ide/README.md`](../ide/README.md#local-modifications-vs-upstream-the-complete-patch-set).
3. From the repo root: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (rebuild the
   Wasm first with `pnpm ide:wasm` if the fork touched a Rust crate).
4. Update the pinned commit here and in `ide/README.md`.

## Verification (2026-10-31, pin `e654919` / `facilis/main` = upstream v1.2.0 + 19 fork commits)

The pin carries the hostful-`file:` recovery (fork issue
[#2](https://github.com/kele23/vivari/issues/2), D-041 in the superproject): if a browser
promotes the first path segment of `"file:" + absolutePath` to the URL **host** — Chromium
does on Windows, `url/url_parse_file.cc` treats it as a UNC path (`file:/home/…` becomes
`file://home/…`) — `fileURLToPath` (and `Bun.fileURLToPath`, and `Bun.file(URL)` through
the same rule) now returns the absolute path the URL meant instead of throwing
`ERR_INVALID_FILE_URL_HOST`. Three-slash URLs, `localhost` and the non-file-scheme error are
unchanged; a real UNC URL maps to `/server/share` rather than throwing, the one deliberate
deviation from Node, recorded in the fork's `FORK.md`. It has no branch yet and waits for the
re-opened upstream `fix/file-url-host-v2` PR. Downstream, this is what let `@facilis.dev/db` go
back to the plain PGlite constructor: the artifact hand-off and the one-boot
`fileURLToPath` shim are gone, and the database locates its own `.data`/`.wasm` again.

| Check | Result |
|---|---|
| `git submodule status` | clean at `e654919…` (`v1.1.5-23-ge654919`) |
| `node vendor/vivari/scripts/spike-esm.mjs` | PASS, including the `[url]` section: a Chrome/Windows-style hostful URL comes back as `/home/user/projects/app/x.js` (spaces/unicode too), `file:/home` comes back as `/home`, a three-slash URL and `localhost` are unchanged, a non-file scheme still throws |
| `pnpm --filter @facilis.dev/db test` | 30/30 (the three shim tests went with the shim) |
| `TEMPLATE=Facilis pnpm ide:smoke` | **PASSED**, `failures: []`: create, install, preview, the framework contract (health, manifest 0 warnings, OpenAPI `x-db-tables`, todos 401, session), IntelliSense, A8/A9/A10/A12, and **`facilisDbInsert`/`facilisDbQuery` = ok with the plain PGlite constructor** — i.e. the database booted through the runtime's recovery, not through a workaround |
| `pnpm ide:smoke` (React template) | **PASSED** (create, install, preview, contract, IntelliSense, A8/A9/A10/A12) |
| `pnpm lint && pnpm typecheck --force && pnpm test --concurrency=1 && pnpm build` + `pnpm format:check` + `node scripts/check-file-length.mjs` | green: 0 lint errors / 109 warnings, 13/13 typecheck, 12/12 test, 8/8 build, Prettier clean, 241 files under the 300-line limit |

## Verification (2026-10-31, pin `97d90ab` / `facilis/main` = upstream v1.2.0 + 15 fork commits)

The pin moves the base from `v1.1.5` to the `v1.2.0` tag (`9c87dec`): upstream's
`node:sqlite` now runs on the Wasm engine `bun:sqlite` already ships, with real SQLite file
locks adjudicated by a table in the File System Worker (`OP_FILE_LOCK` in
`packages/protocol` + `packages/kernel-host/file-locks.js`), because pnpm 11's store index is
a SQLite database opened by concurrent worker threads. `packages/{studio,vfs,codec,crypto}`
are unchanged — the vendored assets (npm 12.2.1, the Wasm builds from `pnpm ide:wasm`) do not
move — while `packages/{runtime,protocol,core,kernel-host}` do. The realignment also reverts
the fork-only `e2f4246` (template binary assets fetched by the kernel), so the superproject
moved the Facilis tarballs to the create message's `files` (`ide/src/facilis/project-assets.ts`,
D-032).
The fork delta is replayed on the tag with one new fix: `9184ee5` builds
`import.meta.url` from an absolute module id, so a relative id can no longer become the URL's
**host** (`file://home/…` → `/user/…`, the PGlite ENOENT of D-039), and `fileURLToPath`
now applies Node's posix rules, throwing `ERR_INVALID_FILE_URL_HOST` instead of converting a
hostful URL into a plausible wrong path; `36c9714` applies the same rule to
`Bun.pathToFileURL` and the debugger's script URLs. That is fork issue kele23/vivari#1,
proposed upstream as PR #31. The CJS load in `@facilis.dev/db` stays: the vendor's in-VM
database rule also forbids a non-entry ESM import of a top-level-await dependency (D-039).

| Check | Result |
|---|---|
| `git submodule status` | clean at `97d90ab…` (`v1.1.5-19-g97d90ab`; the `v1.2.0` tag is not in the local tag list) |
| `node vendor/vivari/scripts/spike-esm.mjs` | PASS, including the four "relative module id must not become import.meta.url's host" checks and the host rejection in `fileURLToPath` |
| `TEMPLATE=Facilis pnpm ide:smoke` | **PASSED**, 57/57: create, install, preview, the framework contract, IntelliSense, A8/A9/A10/A12, and `facilisAuth`/`facilisDbInsert`/`facilisDbQuery` = ok on the new engine. The create request carries the Facilis tarball bytes now, because the kernel no longer fetches `manifest.assets`. |
| `pnpm lint && pnpm typecheck --force && pnpm test --concurrency=1 && pnpm build` | green: 0 lint errors / 109 warnings, 13/13 typecheck, 12/12 test, 8/8 build, `node scripts/check-file-length.mjs` OK (238 files) |
| `pnpm ide:smoke` (React template) | **PASSED**, 18/18 (create, install, preview, contract, IntelliSense, A8/A9/A10/A12) on the new engine |
| `diff -r vendor/vivari/packages/studio ide` | unchanged by the bump: `packages/studio` is identical at both pins, so only the documented IDE patch set shows |

## Verification (2026-10-31, pin `8754dd5` / `facilis/main` = upstream v1.1.5 + 8 fork commits)

All five fixes we had proposed were merged upstream on 2026-10-31 (#19–#23) and released as
`v1.1.5` (`2f461da`), together with the maintainer's follow-ups that closed the review: the
resolver spike, builtin-only `node:` and `pathToFileURL` escaping, the OPFS drain rules in the
docs, the index batch/lock fixes with `spike-opfs-multitab.mjs`, and the per-boot preview
**kernel token** with `spike-sw-multitab.mjs` (Chrome sends an empty `clientId` on a frame's
first navigation; the SW records the token's tab and redirects the token away). The pin drops
the five merged commits — the upstream versions are the base — and replays the eight
Facilis-only ones on top: template binary assets, npm 12.2.1, version-aware pack rebuilds,
pnpm's config out of the base env, scoped boot restore (D-036), cache-body replay (D-037), the
ESM→CJS comment fix, and `hydrate()` under the manifest lock.

The IDE side moved with it: `ide/public/sw.js` is the new upstream worker mirrored through our
Prettier/lint, and two places that build or parse preview URLs had to learn the token —
`ide/src/vv/preview-url.ts` (same-origin pop-outs carry it; the address bar strips it) and
`manifestBaseUrl` in `ide/src/facilis/manifest-client.ts` (a base URL must drop `?`/`#`, or
`/__facilis/manifest/revision` lands inside the token's query string and A9 read `null`).

| Check | Result |
|---|---|
| `git submodule status` | clean at `8754dd5…` (`v1.1.5-8-g8754dd5`) |
| fork offline tier (`node scripts/run-spikes.mjs --offline`) | 28/31 passed, 32 skipped for the missing Wasm build; `python-offline`, `template-syntax` and `clean-checkout` fail identically on a pristine `2f461da` worktree, so they are this sandbox (host pip version, Node's JSX parser), not the pin |
| `pnpm ide:smoke:multitab` | **PASSED** (44 checks): both tabs' previews and reloads stay on their own kernel through the token; idle tab keeps 415 cache files deferred (`deferred` 435, 28 files / 122 KB in the VFS) |
| `TEMPLATE=Facilis pnpm ide:smoke` | **PASSED**: install, preview, contract, IntelliSense, A8 write/HMR, A9 applyPatch (revision now refreshes: `207f3ef…` → `60ce45c…`), A10 git, A12 reboot restores from OPFS |
| `pnpm lint && pnpm typecheck && pnpm test && pnpm build` + `prettier --check .` | green |

## Verification (2026-10-30, pin `4b7be67` / `facilis/main` = upstream v1.1.4 + 12 fork commits)

The pin adds one commit: the ESM→CJS transpiler advances over whitespace **and comments**
between `export` and the declaration it prefixes (`skipSpaceAndComments` in
`packages/runtime/esm.js`). zod v4's build emits `export /*@__NO_SIDE_EFFECTS__*/ function`;
the scanner skipped only whitespace, read the comment's `/` as "not an export form", left the
keyword in the CJS body, and every Nitro route importing zod died in-VM with `Unexpected token
'export' (while compiling …/zod/v4/core/core.js [esm])` — the AsyncFunction retry could not help,
because the transpiled source still contained the keyword. Found by the Facilis probe's new
database roundtrip (the first app code to import zod from a server route inside the
WebContainer); regression case in `vendor/vivari/scripts/spike-esm.mjs`, changeset
`brave-exports-strip`.

| Check | Result |
|---|---|
| `node vendor/vivari/scripts/spike-esm.mjs` | PASS, including the new comment-between-tokens case |
| `TEMPLATE=Facilis pnpm ide:smoke` | **green**, 57/57: the probe registers, logs in, inserts a todo through the authorized handler and reads it back |
| `git submodule status` | clean at `4b7be67…` (`v1.1.4-12-g4b7be67`) |

## Verification (2026-10-30, pin `c83c08f` / `facilis/main` = upstream v1.1.4 + 11 fork commits)

The pin adds one commit: package-manager cache **bodies** are replayed on first read
(`BootOptions.deferCacheFiles`, D-037 in the superproject). The sections below still describe
the pins before it.

| Check | Result |
|---|---|
| `git submodule status` | clean at `c83c08f…` (`v1.1.4-11-gc83c08f`) |
| `pnpm ide:smoke:multitab` | **green**, 44 checks: an idle tab defers **413 cache files** and carries 28 files / 122 KB of VFS instead of the cache; a deferred cache file is replayed on demand (VFS 28→29 files, its real size and bytes); a reloaded project still restores its tree |
| `TEMPLATE=Facilis pnpm ide:smoke` | **green**: cold install, preview paint, the framework contract, IntelliSense and A8/A9/A10/A12 pass (A12's reboot restores the project tree from OPFS) |

Warm-install evidence (not a gate): fresh origin, one react install (297 cache files) — cold
install 27.9 s; a reload boots in 1.16 s with a 27 MB VFS (127 MB with the cache resident); a
later `rm -rf node_modules && npm install` replays 73 of the 297 cache files (297 → 224 deferred)
in 8.5 s. A project whose `node_modules` comes from the dependency cache reads no package cache.
## Verification (2026-10-30, pin `3376ba1` / `facilis/main` = upstream v1.1.4 + 10 fork commits)

This pin adds one commit: the OPFS boot restore is **scoped**. `BootOptions.deferRestoreRoots`
names project roots whose entries stay in the mirror (indexed, not replayed); `vv-restore-roots`
replays one when the embedder opens that project, so a tab carries the projects it opened
instead of every project on the origin (D-036 in the superproject). The section below still
describes the base verification of the nine commits before it.

| Check | Result |
|---|---|
| `git submodule status` | clean at `3376ba1…` (`v1.1.4-10-g3376ba1`) |
| `pnpm ide:smoke:multitab` | **green**, 41 checks (D-033 + D-035 + D-036) |
| `TEMPLATE=Facilis pnpm ide:smoke` | **green** in 126 s: the project creates, installs, paints its preview, the framework contract and IntelliSense are clean and A8/A10/A12 pass — A12's reboot restores the project tree from OPFS through the scoped replay |

## Verification (2026-10-29, pin `a6d6aa5` / `facilis/main` = upstream v1.1.4 + 9 fork commits)

| Check | Result |
|---|---|
| `git submodule status` | clean at `a6d6aa5…` (`v1.1.4-9-ga6d6aa5`: v1.1.4 + ESM-only targets, OPFS mirror priority, `import.meta.resolve`, template binary assets, npm 12.2.1, version-aware pack rebuild, OPFS index merge across tabs, per-kernel preview routing, pnpm config out of the base env) |
| `pnpm ide:smoke` (React template) | **green** on the new engine |
| `TEMPLATE=Facilis pnpm ide:smoke` | **green**, A12 and the OPFS probe pass as normal checks (the D-028 fix is carried by the pin), no known issues; the project's `git status` lists `scripts/vendor-paths.cjs`, so the install ran through the resolver |
| `TEMPLATE=Facilis` smoke against `https://facilis.home/` | **green**, preview painted in 114 s with the pin served through the proxy (the dev server was restarted so the bundled artifacts are the new engine) |
| `pnpm ide:smoke:multitab` | **green**, all 27 checks (D-033) |
| `diff -r vendor/vivari/packages/studio ide` | only the documented IDE patch set |
| Root gates (lint / typecheck / test / build / format / file-length) | pass; `vendor/` excluded, the IDE is a workspace member and included |
| IDE typecheck | `tsc -p tsconfig.app.json --noEmit` with repo TypeScript 7 + `strict`, exit 0 |
| IDE lint | root oxlint/Prettier config, 0 errors |
| IDE dev server | `vite dev` ready ~220 ms; `/` 200, `/src/main.tsx` 200, COOP/COEP present |
| IDE production build | **blocked** on the missing Rust->Wasm `packages/{vfs,codec,crypto}/pkg` in this sandbox |
