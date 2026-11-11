# Development environment

How to build, run and verify Facilis (including the browser IDE) on a bare machine.
Everything here is one command, reproducible, and needs **no root**.

**Status:** current (2026-11-11); this page is the only supported setup recipe.

The IDE runs the vendored Vivari kernel, which means four build artifacts that are
gitignored by upstream and therefore absent from a fresh checkout. `scripts/dev/` produces
them; this page is the contract for those scripts.

## TL;DR

```bash
git submodule update --init vendor/vivari   # once, from a clean clone
pnpm install

pnpm ide:wasm          # Rust -> Wasm kernel (vendor/vivari/packages/{vfs,codec,crypto}/pkg)
pnpm ide:assets        # ide/public/vendor/{npm-pack.bin,pnpm-pack.bin,sqlite/sqlite3.wasm}
pnpm ide:facilis-deps  # @facilis.dev/* tarballs -> ide/public/vendor/facilis/*.tgz
pnpm ide:browser       # headless Chromium + shared libs + fonts (private sysroot, no root)

pnpm ide:dev          # vite dev on 0.0.0.0:5173 (reachable from another machine)
pnpm ide:smoke        # headless acceptance: boot -> create React/TS project -> preview paints
```

Everything is installed under `FACILIS_TOOLING_DIR` (default `/tmp/facilis-dev`), never in
the repository. Nothing under `vendor/` or `ide/public/vendor/` is ever committed.

## Why this page exists

The agent sandbox (and any minimal CI image) differs from a normal dev laptop; these are the
facts the scripts are written against, verified 2026-10-25 on Debian 13 trixie:

| Constraint | Consequence |
|---|---|
| uid 1000, no `sudo`; `apt-get install` impossible | browser + libraries are *downloaded* and unpacked into a private sysroot |
| `$HOME` not writable | rustup, cargo, zig, wasm-pack and fontconfig caches live in `FACILIS_TOOLING_DIR` |
| no `cc`/`ld`/`crt1.o` | Rust build scripts need a host linker -> self-contained Zig `cc` |
| no `xz`, no `python3` | Zig's `.tar.xz` is unpacked with a static busybox `xzcat` |
| no browser, no system fonts | Chromium + DejaVu fonts from Debian packages; without fonts the UI renders zero-height text |
| network reachable: npm registry, crates.io, github.com releases, ziglang.org, deb.debian.org | every download below is pinned and cached, and skipped when present |
| `/tmp` writable, `/dev/shm` only 64 MB | Chromium runs with `--disable-dev-shm-usage` |

## 1. Kernel Rust -> Wasm — `scripts/dev/build-kernel-wasm.sh`

The kernel's Web Workers import `vendor/vivari/packages/{vfs,codec,crypto}/pkg/vivari_*_bg.wasm`.
Upstream builds them with `wasm-pack`; we reproduce that pipeline without root.

| Step | Pinned artefact | Source |
|---|---|---|
| Rust toolchain | `stable` (rustc 1.99.1) + `wasm32-unknown-unknown` | <https://sh.rustup.rs> |
| Packer | wasm-pack 0.13.1 (musl, prebuilt) | GitHub release `rustwasm/wasm-pack` |
| Host linker (only if no `cc`) | Zig 0.17.0 | <https://ziglang.org/download/0.17.0/zig-x86_64-linux-0.17.0.tar.xz> |
| Bindgen | wasm-bindgen = the version in `packages/vfs/Cargo.lock` (0.2.126) | GitHub release `rustwasm/wasm-bindgen` |

`wasm-pack` cannot fetch `wasm-bindgen-cli` itself in this image (it falls back to
`cargo install`, which needs `ring`'s C build), so the script seeds the prebuilt binary into
`$WASM_PACK_CACHE/.wasm-bindgen-cargo-install-<version>/bin/` — the layout wasm-pack expects.

```bash
sh scripts/dev/build-kernel-wasm.sh            # or: pnpm ide:wasm
sh scripts/dev/build-kernel-wasm.sh --force    # after bumping the vendor submodule
FACILIS_TOOLING_DIR=/opt/facilis-dev sh scripts/dev/build-kernel-wasm.sh
```

Outputs (gitignored, in the read-only submodule — the only sanctioned write there):

| Crate | JS glue | Wasm |
|---|---|---|
| vfs | `vivari_vfs.js` 24 KB | `vivari_vfs_bg.wasm` 148 KB |
| codec | `vivari_codec.js` 10 KB | `vivari_codec_bg.wasm` 1.0 MB |
| crypto | `vivari_crypto.js` 37 KB | `vivari_crypto_bg.wasm` 794 KB |

Cost: ~2 min of downloads (Zig alone is 57 MB) + ~100 s of cargo builds on 16 cores.
Disk: ~3.5 GB with the per-crate target dirs (safe to delete `$FACILIS_TOOLING_DIR`).

## 2. Runtime assets the kernel fetches — `scripts/dev/vendor-assets.sh`

The kernel serves *real CLIs* inside the VM; their payloads are gitignored build artifacts
that upstream generates with `scripts/vendor-*.mjs` (which shell out to a host `npm` — absent
here, so the script extracts the published tarball instead).

| Asset | Content | Served as |
|---|---|---|
| `npm-pack.bin` | real npm 12.2.1 (3.04 MB gz), the project installer (D-032) | `/vendor/npm-pack.bin` |
| `pnpm-pack.bin` | real pnpm 9.15.9 (3.66 MB gz) — only for rolldown's wasm fallback, not a project manager (D-032) | `/vendor/pnpm-pack.bin` |
| `sqlite/sqlite3.wasm` | SQLite wasm (865 KB) | `/vendor/sqlite/sqlite3.wasm` |
| `facilis/*.tgz` | this workspace's `@facilis.dev/{analyze,auth,core,db,nitro,storage,time}` (0.0.0), packed with `pnpm pack` | `/vendor/facilis/facilis-<pkg>-0.0.0.tgz` |

```bash
sh scripts/dev/vendor-assets.sh          # or: pnpm ide:assets
sh scripts/dev/vendor-assets.sh --all    # + yarn, corepack, tsgo, pyodide, ruff (needs host npm)

sh scripts/dev/vendor-facilis-deps.sh          # or: pnpm ide:facilis-deps
sh scripts/dev/vendor-facilis-deps.sh --all    # + @facilis.dev/{ai,blocks}
```

The generators write into `vendor/vivari/packages/studio/public/vendor` (gitignored, inside
the submodule); the script copies the results into `ide/public/vendor/` (also gitignored).

The second script packs the template's `@facilis.dev/*` dependencies — `analyze auth core db
nitro storage time` today, plus `ai` and `blocks` with `--all` — from this workspace into
`ide/public/vendor/facilis/facilis-<pkg>-<version>.tgz` — `0.0.0` today, because those
packages are published to npm (D-164) but still delivered to the WebContainer as tarballs.
Generated projects install with **npm** inside the WebContainer
(D-032) and the Facilis template declares them as `file:` dependencies under its own
`./vendor/`, inlined from the IDE build at create time: no package manager fetches the
framework from the studio over HTTP. Three in-VM constraints shape that:

- **The tarballs are inlined, not fetched.** The IDE page fetches each `manifest.assets`
  path from its own origin and writes the bytes into the project's `./vendor/` in the create
  request (`ide/src/facilis/project-assets.ts`), so the project is self-contained once
  created and no registry or HTTP-egress constraint can break the install.
- **The tarballs export `dist/`, not `src/`.** The generated project's Vite config is loaded
  with `--configLoader native`, and a native ESM loader refuses to strip types from files
  under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`); the config imports
  `@facilis.dev/nitro/vite`, so that entry must be JS. The script builds each package, packs it,
  then rewrites the packed manifest's `exports` from `./src/*.ts` to `./dist/*.js` (the
  workspace source keeps its `src` entry points). `@facilis.dev/nitro` also derives its Nitro
  handler paths from its own module extension for the same reason.

- **The specs are made absolute before npm runs.** npm re-derives a RELATIVE `file:` target
  when it normalizes a spec, and inside the VM that derivation was measured producing
  `/user/projects/...` instead of `/home/user/projects/...`, so every install died with
  ENOENT on a tarball that exists. The template's install command runs
  `scripts/vendor-paths.cjs` first, which pins each `@facilis.dev/*` spec to an absolute path
  and fails loudly if a `vendor/` tarball is missing (D-032).

`pnpm pack` rewrites the workspace-internal `workspace:*` specifiers to `0.0.0`, so pnpm
resolves the inter-package dependencies from the tarballs and never asks the registry for
`@facilis.dev/*`. The packages are also published to npm (D-164), but the in-VM install keeps
using the tarballs so it never depends on registry availability; switching the template to the
registry would only change delivery, not the project code.
The script removes stale tarballs first and fails if a packed manifest still contains
`workspace:`, does not export `dist/`, or is missing `dist/index.js`. Re-run it after changing package sources; the directory is
gitignored like the rest of `ide/public/vendor/`.

`vendor/locks/index.json` and `vendor/depcache/index.json` are **not** generated: the kernel
logs a warning and installs every project from scratch (slower, still correct).

## 3. Headless browser — `scripts/dev/fetch-browser.sh`

```bash
sh scripts/dev/fetch-browser.sh          # or: pnpm ide:browser
```

No root, so the script downloads Debian's `chromium` **and its dependency closure**
(~200 MB of `.deb`) with `apt-get download` into a private apt state, unpacks everything with
`dpkg-deb -x` into `$FACILIS_TOOLING_DIR/browser/sysroot`, and adds:

- `fonts-dejavu-core`, `fontconfig`, `fontconfig-config` — and a generated `fonts.conf`
  pointing at the sysroot. **Fonts are load-bearing**: with none installed, every line box
  has zero height, the UI renders blank, and even `element.innerText` returns `""`.
- `browser/chrome/chrome` -> `sysroot/usr/lib/chromium/chromium` (Chromium 156).

Use an existing browser instead:

```bash
FACILIS_CHROME=/usr/bin/chromium FACILIS_BROWSER_SYSROOT= \
  pnpm ide:smoke
```

The smoke test sets `LD_LIBRARY_PATH`, `FONTCONFIG_FILE` and `HOME` for the browser itself,
so no shell environment is required.

## 4. Running the IDE

```bash
pnpm ide:dev
```

The IDE's `dev` script passes `--host`, so the server binds **every interface** — that is what
lets another machine (or the `facilis.home` proxy) reach it. Append `--host 127.0.0.1` to the
script call to keep it loopback-only; `pnpm ide:smoke` does exactly that for its own server.

- The dev server must send `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp` (they unlock `SharedArrayBuffer`); this is in
  `ide/vite.config.ts` and is asserted by the smoke test.
- Vite 8 rejects unknown `Host` headers. The sandbox forwards this app as `facilis.home`;
  `server.allowedHosts` allows it (override with `FACILIS_DEV_HOST`).
- **The dev script runs Vite's full-bundle mode** (`vite --experimentalBundle`, D-031).
  Middleware mode serves every module separately: a dev session issues thousands of requests —
  each guest process is a browser Worker loading the runtime's ~190-module graph, per spawn — and
  a long-lived proxy connection cannot absorb that (see the next bullet). Bundle mode serves a few
  chunks instead, so a whole session stays far below the proxy's per-connection cap. Run
  `pnpm --filter @facilis.dev/ide dev:middleware` for the old server when debugging a Vite plugin or
  the dev HMR semantics (bundle mode computes HMR boundaries in the browser).
- **Reverse proxy on HTTP/2 (still worth fixing).** nginx retires an HTTP/2 connection after 1000
  requests (`keepalive_requests`, formerly `http2_max_requests`); middleware mode crossed that
  boundary several times per session and Chromium lost in-flight module fetches, which failed a
  Worker's graph load and with it the install (`worker.js: process worker failed to start`).
  Bundle mode (D-031) keeps the volume below the cap, so this is no longer on the critical path,
  but raise the cap on the studio vhost (`keepalive_requests 100000;` /
  `http2_max_requests 100000;`) or serve it over HTTP/1.1 (`http2 off`) anyway — see D-029.
- In the UI: **New project -> name -> Create**. The IDE scaffolds a Facilis app in its VFS —
  the only creation path (D-051) — runs `npm install` and then
  `npm run dev -- --configLoader native`, and opens the preview at `/preview/3000/`.
  `Import a folder` / `Import a repository` cover existing code.
- The scaffolded project **is** `examples/todo-app` plus the IDE wrappers (D-062): editing
  the example changes what Create produces, and the smoke drives the framework endpoints
  from the IDE page rather than from code inside the project. The tree is inlined at IDE
  build time, so restart `pnpm ide:dev` after changing the example; run
  `pnpm ide:facilis-deps` after changing packages packaged as tarballs
  (`analyze auth core db nitro storage time`) so the vendored versions match — and recreate any
  project created before that run: its `vendor/*.tgz` are inlined at creation time, so a
  project keeps the tarballs it was born with.

## 5. Headless acceptance — `scripts/dev/smoke-ide.mjs`

```bash
pnpm ide:smoke                       # starts its own dev server (first free port from :5199)
node scripts/dev/smoke-ide.mjs --url http://127.0.0.1:5173/   # use a running server
```

It drives the real UI over the Chrome DevTools Protocol (`scripts/dev/cdp.mjs`, no npm
dependency) and asserts, in order: COOP/COEP headers, kernel online, home text rendered,
new-project dialog opens, project name filled, `Create` enabled, project created,
`preview-paint` boot mark, preview iframe mounted, preview answers `200` with HTML,
no page errors, no console errors, no failed requests. Exit code is non-zero on any failure.

It then asserts the framework contract from the Facilis app inside the preview (after
`pnpm ide:facilis-deps`): `health: ok`,
`manifest: ok` with **0 warnings**, a revision, `/_openapi.json` carrying `x-db-tables` for
`/api/todos`, an unauthenticated `/api/todos` → 401, and a **database roundtrip** — the smoke
registers a user, logs in (the session cookie is staged by h3's `setCookie` through
`@facilis.dev/nitro/session`, and survives to the next request), inserts a todo through the
authorized handler and reads the list back (11 endpoint checks). That last group is
the only in-VM proof that PGlite, the migrations, RLS, permissions and the session middleware
work together inside the WebContainer. The smoke drives those requests from the IDE page
against the preview's `/preview/<port>/` base — same origin, so the session cookie applies —
because the generated starter is the reference app and carries no test instrumentation
(D-062); `scripts/dev/smoke-facilis.mjs` owns the assertions and dumps the preview HTTP body
+ dev log into `facilis-diagnostics.json` on failure.

It also runs `scripts/dev/smoke-intellisense.mjs`, before the write checks:
it asks the same Monaco TypeScript worker the editor uses (`getSemanticDiagnostics`) for
`src/app.tsx` and `src/main.tsx`, and fails on a module-resolution error (TS2307 "Cannot
find module"). That is the user-visible symptom of a generated project that does not install
the `@types/*` packages its imports need (react, react-dom): the IDE only feeds installed
`node_modules/**/*.d.ts` to the language service. An unreachable worker — or a worker/model
call that never settles — fails the check too, never counts as a skip (the harness races each
page promise so a wedge fails the smoke instead of hanging it).

It also runs `scripts/dev/smoke-write.mjs`, which drives the dev-only
`window.__ide` / `window.__facilis` handles through the real controller to verify the VFS write
path (SPEC §14.1 items 4-7, D-025): **A8** (write → Explorer + editor, client HMR without
reloading the preview document, and the in-VM server route reloading its handler), **A9**
(`applyPatch` multi-file batch, unsafe-path rejection before any write, revision refresh and
delete), **A10** (`git init` / status / commit over the VFS) and **A12** (flush +
`Page.reload` → the reloaded tab lands on its project, not Home, and the OPFS mirror
restores the uncommitted file). 24 checks, recorded in `report.json`; a failure also dumps
`write-diagnostics.json` (including the OPFS mirror manifest's view of the file, so "never
mirrored" and "never restored" are distinguishable).

The smoke then runs `scripts/dev/smoke-chat.mjs`: it opens the AI Chat activity view,
configures the **dev-only mock provider** in the real settings dialog (no key, no network),
sends a message, reviews the proposal card and clicks Apply, then reads the written file back
from the VFS; it finally clicks **Undo** and asserts the file is gone again. The mock streams its
canned `AIResponse` in chunks (D-047), so the same run exercises the streaming bubble too; the
production build cannot select it (D-045). It finally clicks **Project instructions** and asserts
`AGENTS.md` lands in the VFS (D-048). The smoke covers the real settings/parser/patch/apply/undo
and instructions path without an LLM. The last step opens Home and deletes the project through
the typed-confirmation dialog, asserting both the files and the recent-list entry are gone
(D-050).

To exercise the PTC trace without a key, keep the **Mock (dev)** provider and send a message
containing "ptc" (or "esplora"): the mock answers with one exploration program, the runner
executes it, the trace card renders it, and the second call returns the usual demo proposal
(D-101).

One page error is expected and filtered: the first edit in a project whose imports do not all
resolve makes Monaco 0.55.1's TS worker post a TS 6.0 diagnostic that carries a callback
(`DataCloneError … could not be cloned`). It is recorded as `knownPageErrors` in the report
instead of failing the run — an editor defect, not a VFS one (D-026).

**A12**'s strict condition (an uncommitted file surviving a reboot) used to fail because the
kernel's OPFS write-behind queue stopped draining after the in-VM install (D-028), and was
reported as `KNOWN` in `report.json` (`write.knownIssues`) instead of failing. The 2026-10-31
runs pass it: the flush + `Page.reload` restores the uncommitted file from OPFS.

Artifacts (screenshots + `report.json`) land in `SMOKE_ARTIFACTS`, default
`$FACILIS_TOOLING_DIR/smoke-artifacts/<epoch-ms>/`. A finished run keeps the newest
`SMOKE_KEEP_RUNS` dirs (default 5) and prunes the older ones, so repeated runs do not fill the
tooling dir; `--keep-artifacts` or a custom `SMOKE_ARTIFACTS` skips pruning and leaves the
layout to the operator (`scripts/dev/run-artifacts.mjs`).

| Env var | Default | Meaning |
|---|---|---|
| `STUDIO_URL` / `--url` | start own server on `SMOKE_PORT` | target origin |
| `SMOKE_PORT` | `5199` | port for the self-started dev server |
| `SMOKE_ARTIFACTS` | see above | evidence directory (pinned: pruning is skipped) |
| `SMOKE_KEEP_RUNS` | `5` | artifact dirs kept under the default root; older ones pruned at the end of a run |
| `BOOT_TIMEOUT_MS` / `PREVIEW_TIMEOUT_MS` | `180000` / `300000` | budgets |
| `FACILIS_PROBE_TIMEOUT_MS` | `120000` | budget for the preview to answer the framework endpoints |
| `FACILIS_WRITE_TIMEOUT_MS` | `45000` | budget for each A8/A9 write-and-observe check |
| `FACILIS_REBOOT_TIMEOUT_MS` | `120000` | budget for the A12 reboot/restore check |
| `FACILIS_PROFILE_DIR` | unset (throwaway profile) | reuse one browser profile across local runs — OPFS keeps the package manager store and depcache, so iterations after the first skip the cold install. Never for CI/verdicts |
| `FACILIS_CHROME` / `FACILIS_BROWSER_SYSROOT` / `FACILIS_FONTCONFIG` | from `browser/` | browser paths |

Reference runs on 16 cores: kernel online **0.6 s** against an already-warm dev server
(**2.6 s** cold, while Vite is still transforming the app), preview painted **31-40 s** (in-VM
install dominates; ~103 s on a cold throwaway profile). The Facilis run is green end to end:
manifest zero warnings, editor IntelliSense clean, the **database roundtrip** green
(session survives, insert and read-back ok), A8-A12 green, and the Home delete flow green
(files + registry entry removed). Artifacts under `$FACILIS_TOOLING_DIR/smoke-artifacts/`.

The PTC sandbox runner (D-101) has its own targeted browser check, without booting the IDE:

```bash
node scripts/dev/check-ptc-runner.mjs
```

It serves the real `ide/public/ptc-runner.html` with the production CSP/COOP/COEP headers and
asserts the result comes back, the tool RPC round-trips, the worker's `fetch` is blocked, the
iframe origin is opaque and still relays while a program is stuck, a >5 s loop is terminated,
and a fresh sandbox works afterwards. Script: `scripts/dev/check-ptc-runner.mjs`.

### 5.1 Several projects at once — `scripts/dev/smoke-multitab.mjs`

```bash
pnpm ide:smoke:multitab              # starts its own dev server (first free port from :5201)
node scripts/dev/smoke-multitab.mjs --url http://127.0.0.1:5173/
```

One project per browser tab, several tabs at once (D-033/D-035): each tab boots its own
kernel, dev server and preview; `?project=<rootPath>` makes a tab reopen — and run — its
project after a reload; the same project cannot be open in two tabs (a Web Lock, surfaced as
a toast), and a tab holds exactly one project (opening a second replaces the first, and the
label is the folder name, never a create-form name). The smoke asserts, in order: two kernels
boot; tab A runs a React project and paints its preview; creating beta in tab A replaces alpha
and labels the tab by the folder; tab B is opened at `?project=<beta>` and paints the **Vue**
project; both previews survive a forced reload on **their own** kernel (both dev servers bind
5173, so the port identifies nothing); a third tab pointed at tab A's project is refused and
leaves no folder open; the boot restore is scoped (D-036 — a reloaded tab hydrates only the
project it opens: its real bytes come back, and a project it never opened stays out of its
VFS); one tab's write does not erase the other tab's paths from the shared OPFS index; Home's
"Open in a new tab" button opens a tab whose URL names the project; a project created with a
form name different from its directory is labelled by the directory; and the recent-projects
registry keeps every tab's projects. Exit code is non-zero on any failure. Reference run on
16 cores: 41 checks, ~4 min (two in-VM installs); artifacts (screenshots + `report.json`)
under `$FACILIS_TOOLING_DIR/smoke-multitab/<epoch-ms>/`, with the same retention as §5.

## 6. Known in-VM constraints

| Constraint | Effect | Handling |
|---|---|---|
| Vite 8 (rolldown) cannot start in the VM | `@rolldown/binding-wasm32-wasi@1.2.15` pins `@emnapi/core@2.0.0-alpha.5`, which `@napi-rs/wasm-runtime@1.2.6` rejects (`TypeError: Cannot set properties of undefined (setting 'initWorker')`); rolldown's webcontainer fallback re-installs the same broken set | **every Vite template is pinned to `vite@^7.1.0`** (verified: Vite 7.3.7 boots in 259 ms). Upstream fix is [rolldown#11292](https://github.com/rolldown/rolldown/pull/11292) — see §6.1 |
| No template locks / depcache | kernel logs `vendor/locks` + `vendor/depcache` warnings, installs from scratch (~25-45 s per project) | optional: run the upstream `vendor:locks` / `vendor:depcache` generators |
| `@rolldown/binding-wasm32-wasi` still listed in templates | ~14 MB of dead weight per install | kept so a future Vite 8 retry is a version bump, not a re-import |
| PGlite dev database is in-memory | a worker restart would reset it (and every server-route edit restarts it) | the cluster is snapshotted to `<project>/.facilis/db/snapshot.tar.gz` and restored on boot, so data survives a dev-server restart (D-052). At most ~1 s of writes can be lost on an abrupt kill |
| Binary uploads live on the project filesystem in dev | the local driver writes `<project>/.facilis/binary/<hh>/<hash>` through the kernel VFS, so the OPFS mirror persists blobs like the dev database (D-052); production uses S3, and a production boot with `storage.driver: "local"` refuses storage with the `storage_local_in_production` manifest warning | leave the dev default `local`; set `driver: "s3"` + `bucket`/`region` and `FACILIS_S3_ACCESS_KEY_ID`/`FACILIS_S3_SECRET_ACCESS_KEY` (+ `FACILIS_STORAGE_SECRET`) in production — SPEC §5.10 |
| At-rest encryption is opt-in and needs a stable key even in dev | with `storage.encryption.enabled: true` the app stores AES-256-GCM ciphertext and every boot needs the same `FACILIS_STORAGE_ENCRYPTION_KEY` — there is no per-boot random fallback, because blobs written with a throwaway key would be undecryptable after a restart (D-117) | set `FACILIS_STORAGE_ENCRYPTION_KEY` (required when encryption is on; 32-byte KEK as base64 or 64-character hex) plus optionally `FACILIS_STORAGE_ENCRYPTION_KEY_ID` (active-key label, default `primary`) and `FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS` (JSON `{ "keyId": "key" }`, decrypt-only rotation) in the environment before starting the dev server; enabling it on a project that already holds plaintext blobs means re-uploading them — SPEC §5.10 |
| Storage streams end to end; the multipart parser materializes the upload once | the framework's storage/crypto/download path never buffers the whole file (D-117): the local driver writes a temp file and renames it, an S3 PUT stages the upload stream (ciphertext when encryption is on) to a `0600` temp file while hashing and counting it (SigV4 needs the payload hash and length) and deletes it after the PUT, and downloads stream with `content-length` taken from `facilis_files.size` (with encryption on there is no presigned S3 redirect — every download proxies through the app and decrypts). Uploading is not zero-copy for the whole request: `request.formData()` materializes the form once, bounded by `maxUploadBytes` (default 10 MiB, hard cap 100 MiB) | keep the upload limit within what the VM/browser can hold; nothing else to configure — SPEC §5.10 |
| Package managers cannot install plain-http URL dependencies | npm's `agent-base` HTTP agent makes the runtime skip the fetch-backed egress (`internal/http-egress` only egresses with the stock agent), so npm dials the virtual network and fails with `ENOTFOUND`; registry `https://` traffic is unaffected | **nothing on this path any more:** generated projects install with npm from `file:` tarballs the IDE inlines into the create request (D-032), so no install touches the studio over HTTP. Do not reintroduce URL dependencies |
| Nitro's traced dist copies are ESM-only, but the VM loader resolved CJS conditions | `nitro@3.0.260903-beta` prunes `dist/node_modules` to the ESM build (`defu`: `main`/`require` → `lib/defu.cjs` is absent, only `dist/defu.mjs` ships); before the fork fix Vivari's `runtime/module.js` took the CJS/`main` target even for ESM imports and did not fall back to `module`, so resolution missed and the boot died with `Cannot find module …` | **no template workaround any more:** the fork's resolver returns the first condition target that exists (`fix/runtime-esm-only-targets`, PR #19), so nitro's vendored ESM copies load and the generated `package.json` no longer pins them (2026-10-29: `pnpm ide:smoke` green with the whole pin list removed). Only `picomatch` (nitro's builder `__require`s it at run time) and `@vercel/queue` (lazy, Vercel Queues preset) stay — see D-024 |
| Nitro's default dev runners cannot start | `node-worker`/`node-process` resolve their entry with `fileURLToPath(import.meta.resolve(…))`, and the VM runtime's `import.meta.resolve` is not a file URL → `TypeError: Invalid URL` | the template sets `devServer: { runner: "self" }` in its `facilis.config.ts` `nitro` section (single process); Nitro then owns the listener on **port 3000**, so the template's preview port is 3000 |
| Only npm is the project's package manager | the IDE vendors one, pinned in lockstep with the VM's Node: `NPM_VERSION` in `scripts/dev/vendor-assets.sh` must equal the template's `packageManager`, and `ide/src/facilis/package-manager.test.ts` fails if they drift. npm also re-derives a RELATIVE `file:` target when it normalizes a spec, and inside the VM that derivation lost `/home` (`file:./vendor/x.tgz` → `/user/…`), so every install died on a tarball that exists | the template's install command runs `scripts/vendor-paths.cjs` first, which pins the `@facilis.dev/*` specs to absolute paths and fails loudly if a `vendor/` tarball is missing (D-032 follow-up); bump both versions, rebuild `pnpm ide:assets`, re-run `pnpm ide:smoke` |
| Facilis template uses Vite 8 | the framework's `@facilis.dev/nitro` peers `vite@8.3.5` and its route-metadata pass imports `rolldown/utils` (the WebContainer-safe parser, D-093), so the Vite 7 pin does not apply | template ships `vite@8.3.5` + `@rolldown/binding-wasm32-wasi` + the `@emnapi/core`/`@emnapi/runtime` `2.0.0-beta.2` override (verified boot) |

| Two tabs on one origin | each tab is its own kernel and dev server, so a pair costs ~0.7 GB of worker memory and the second tab boots +2.5-2.9 s (it restores the shared tree); both dev servers bind the same in-VM port, and the VFS mirror's index is per origin | preview traffic is routed per preview frame by the Service Worker, the index is merged per tab under a Web Lock, and the Studio claims each project so two tabs cannot open the same one — `pnpm ide:smoke:multitab` asserts it (D-033) |

### 6.1 When Vite 8 comes back

The failure is a dependency-set bug in rolldown, not in this repo: `@napi-rs/wasm-runtime@1.2.6`
sets `addonModule.initWorker`, which only `@emnapi/core@2.0.0-beta.2` provides, while the
published `@rolldown/binding-wasm32-wasi@1.2.15` ships `2.0.0-alpha.5`.

- **Upstream fix:** [rolldown#11292](https://github.com/rolldown/rolldown/pull/11292)
  ("update emnapi to 2.0.0-beta.2 and pin @napi-rs/wasm-runtime to 1.2.6", opened 2026-10-25)
  updates the emnapi pins and adds `scripts/misc/pin-wasi-binding-deps.mjs` so the published
  wasi binding stops floating with `~<latest>`.
- **When:** rolldown releases weekly (1.2.13 Oct 7, 1.2.14 Oct 14, 1.2.15 Oct 21) → expect
  1.2.16 within days of the merge. Vite 8.3.5 depends on `rolldown ~1.2.14`, so **no Vite
  release is needed**: a fresh install picks up the fixed binding.
- **Unblock checklist:** bump `rolldown` in the VM, update the Vite pin in
  `ide/src/facilis/project-files.ts`, run `pnpm ide:smoke` (it asserts the preview document is
  the project), then delete this section and the note in `docs/DECISIONS.md` (D-021).
- **Verified interim patch (2026-10-25):** the generated project can pin the peer instead —
  `"overrides": { "@emnapi/core": "2.0.0-beta.2", "@emnapi/runtime": "2.0.0-beta.2" }` in the
  project's `package.json`. Tested in the VM: after `npm install` with that override,
  `vite 8.3.5` started (`ready in 803 ms`, port bound) and the preview painted. Pinning
  `@napi-rs/wasm-runtime` to `1.2.5` (which pairs with alpha.5) is the other way round.
  Not shipped in the Facilis template: it is a one-line addition to its pinned
  `package.json` and upstream removes the need within days.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Blocked request. This host ("…") is not allowed.` | Vite 8 Host check | `FACILIS_DEV_HOST=<host> pnpm --filter @facilis.dev/ide dev …` |
| UI renders but every text label is missing/blank | no system fonts for Chromium | `pnpm ide:browser`, or point `FACILIS_FONTCONFIG` at a `fonts.conf` |
| `[pnpm] load failed (Failed to fetch)` | `ide/public/vendor/pnpm-pack.bin` missing | `pnpm ide:assets` |
| `error when starting dev server: [facilis] failed to load …/facilis.config.ts` with no reason in the message | the vendored `@facilis.dev/*` tarballs predate a framework change, so the in-VM config is validated by an older schema: a section added since (e.g. `jobs`, D-107) is rejected at import by `defineConfig`, and the loader used to drop the schema error | the loader now prints the underlying cause (rerun `npm run dev` and read it). Regenerate the tarballs (`pnpm ide:facilis-deps`), restart `pnpm ide:dev`, then **recreate the project** — a project's `vendor/*.tgz` are inlined at creation time |
| `manifest` warns `storage_*` and the file routes answer `503 storage_unavailable` | binary storage failed to boot: `storage_local_in_production` means a production build still has `storage.driver: "local"`; `storage_s3_credentials_missing` / `storage_secret_missing` mean the `FACILIS_S3_*` / `FACILIS_STORAGE_SECRET` env vars are absent; `storage_encryption_key_missing` / `storage_encryption_key_invalid` mean `storage.encryption.enabled` is on but `FACILIS_STORAGE_ENCRYPTION_KEY` is absent or the key, key id or retired-keys JSON is malformed; `storage_boot_failed` is an unexpected driver-construction failure (the dev log carries the cause) | set the variables in the deployment environment, or fix the driver configuration, and restart; the rest of the app keeps working, only the file routes degrade (SPEC §5.10, D-116/D-117) |
| `Cannot find native binding` when a project's dev server starts | the project uses Vite 8 / rolldown | see §6; create the project from a template (Vite 7) or pin `vite@^7` |
| `Could not resolve "../../../vfs/pkg/vivari_vfs.js"` | kernel wasm not built | `pnpm ide:wasm` |
| `ERR_PNPM_IGNORED_BUILDS` on a fresh install | pnpm 12 requires an explicit decision for every package with an install script | already configured in the root `pnpm-workspace.yaml` (`allowBuilds`); decide new ones there, never with an interactive `pnpm approve-builds` |
| `Failed to resolve import "@vivari/core"` | submodule not checked out | `git submodule update --init vendor/vivari` |
| Studio shows the Vite error overlay (or logs `@babel/parser` errors) although the code typechecks | the running `vite dev` predates a `pnpm install` / new workspace dependency (e.g. `@facilis.dev/core` for the IDE i18n), or caught a half-written file during HMR | restart the dev server (`Ctrl-C`, `pnpm ide:dev`) and reload the tab. Verify the live server end-to-end with `node scripts/dev/smoke-ide.mjs --url http://127.0.0.1:5173/` — it drives the real UI, not just the HTML |
| Port 5173 busy (`--strictPort`) | a previous dev server is still alive | `kill -TERM -- -<pgid>` (servers are started with `setsid`) |
| A reload still loads the previous build, or `Reset everything` is followed by the same failure | a Service Worker is not part of the browser's “cached files”: it stays registered and keeps controlling the origin, and CacheStorage/OPFS are not cleared by a cache wipe either | Home → `Reset everything` now unregisters every Service Worker, deletes every CacheStorage entry and wipes the OPFS VFS + dependency cache before reloading (`ide/src/vv/origin-reset.ts`). By hand: DevTools → Application → Service Workers → Unregister, then Application → Storage → Clear site data (all boxes) |
| An in-project `npm install` warns about a package version the template never pins (e.g. `react-dom@19.2.8` while the todo template pins `19.3.1`), and a later identical Run succeeds | stale per-origin VM state, not the template: the OPFS VFS still carries the previous project's `node_modules` and npm cache, so npm reconciles against a tree the current `package.json` never asked for (the generated package.json comes from the example, D-062, which pins `react` and `react-dom` in lockstep) | clear the VM state before touching the code: Home → `Reset everything` (wipes the OPFS VFS + dependency cache, `ide/src/vv/origin-reset.ts`), or in the project `rm -rf node_modules package-lock.json` and press Run again. If it reproduces from a fresh profile, it is a real install bug: capture the full `npm warn` block with its `While resolving`/`Found` lines |
| `File URL host must be "localhost" or empty on posix` at PGlite boot | **Chromium's file-URL parser is platform-dependent**: on Windows anything that is not a drive spec and does not have exactly three slashes is parsed as UNC, so `new URL("file:" + path)` = `file:/home/…` gets `home` as the URL **host** (`file://home/…`) and PGlite's self-located `pglite.data` lands outside the tree (Chrome 156 Windows vs Linux both reproduced) | fixed in the pinned kernel: `e654919` recovers the path from a hostful `file:` URL in `fileURLToPath`/`Bun.fileURLToPath` (**kele23/vivari#2**, D-041) — bump the pin if you are on an older one; `@facilis.dev/db` carries no shim |
| A test that globs `examples/todo-app` keeps seeing an old file list (e.g. `release-routes.test.ts` expects 14 routes, gets 8) after the example gained files | the vitest FS module cache (`--fsModuleCachePath=node_modules/.vitest-cache`, passed by the root `test` script) still holds the `import.meta.glob` transform of `example-template.ts` from before the files existed | delete the package cache (`rm -rf ide/node_modules/.vitest-cache`) and rerun; it regenerates |

## 8. Cleaning up

```bash
rm -rf /tmp/facilis-dev                    # toolchain + browser + smoke artifacts (~4 GB)
rm -rf ide/public/vendor                   # runtime assets (~7 MB, rebuilt by ide:assets)
rm -rf vendor/vivari/packages/*/pkg        # kernel wasm, rebuilt by ide:wasm
```

## 9. Deploying the IDE — `ide.facilis.dev`

Production is a **Cloudflare Pages** project named `facilis-ide`, served at
<https://ide.facilis.dev>. `.github/workflows/deploy-ide.yml` runs on every push to `main`
that touches the IDE inputs: it rebuilds the four gitignored artifacts (`pnpm ide:wasm` —
cached by kernel commit — then `pnpm ide:assets` and `pnpm ide:facilis-deps`), runs
`pnpm --filter @facilis.dev/ide build:app`, and uploads the finished `ide/dist` with
`wrangler pages deploy`. The same pushes also publish the `@facilis.dev/*` packages (D-164):
`.github/workflows/publish-packages.yml` runs in parallel with this deploy, see §13. **Nothing is run locally**, and Cloudflare's own Git integration is
deliberately not used (D-077): it cannot cache the Rust/Wasm toolchain, and the pipeline should
deploy exactly the tree this repo builds.

The agent build in CI is the same one described in §1–§2; the only difference is that the
kernel Wasm is restored from the Actions cache (keyed by the pinned `vendor/vivari` commit)
instead of rebuilt.

### 9.1 Headers and caching — `ide/public/_headers`

Vite copies `ide/public/_headers` into `ide/dist`, and Pages parses it there (it is never
served). Rules stack, so cross-origin isolation lives on `/*` and the per-path rules only
add caching: `assets/*` is content-hashed and `immutable`; `vendor/` (the runtime CLIs the
kernel fetches by name) and the DevTools trees revalidate. `_headers` is the only place
these live — do not configure them in the Cloudflare dashboard, or a repo build stops
matching production.

The workflow asserts the deployed production URL carries COOP/COEP and that the shell,
service worker and PWA files answer `200`, so a header regression fails the deploy instead of
shipping an IDE whose kernel cannot boot.

### 9.2 One-time account setup

The operator supplies two repository secrets and adds one custom domain; nothing runs locally.

1. **API token.** Create a token on the account that owns `facilis.dev` with the single
   permission `Account → Cloudflare Pages → Edit` (project creation and deploy). No zone-wide
   rights are needed. Store it as `CLOUDFLARE_API_TOKEN`.
2. **Account id.** Dashboard sidebar (or `GET /client/v4/accounts`) → store it as
   `CLOUDFLARE_ACCOUNT_ID`; it is not secret, but the workflow reads both from the secrets
   store.
3. **First deploy.** A push to `main` (or **Deploy IDE → Run workflow**) creates the Pages
   project `facilis-ide` (`production_branch: main`), deploys and verifies the headers on
   `facilis-ide.pages.dev`. Account state is read back on later runs, so a deleted project
   needs nothing but a re-run.
4. **Custom domain, once.** In the dashboard open **Workers & Pages → facilis-ide → Custom
   domains → Set up a custom domain**, enter `ide.facilis.dev` and activate it: because the
   zone is on Cloudflare, Pages creates the proxied CNAME and the certificate itself. The
   workflow's domain step is only an attempt for tokens that also carry the zone permissions —
   without them it prints a warning and the click above is the whole setup.

Re-run the workflow after step 4 and the verify step also checks the custom origin; the
certificate takes a few minutes on the first activation.

## 10. Real git in the IDE — the same-origin proxy (D-079)

Git hosts send no CORS headers on their smart-HTTP endpoints, so the tab reaches git through a
stateless proxy that forwards `/git-proxy/<host>/<path>` to `https://<host>/<path>` and adds the
CORS headers. The same handler runs in three places:

- **`pnpm ide:dev`** — `ide/vite.git-proxy.ts` mounts it as Vite middleware, on the dev server's
  own origin. Nothing to start, nothing to configure; `projects.gitProxy` defaults to
  `"same-origin"` in the open profile.
- **`ide.facilis.dev`** — `ide/functions/git-proxy/[[path]].ts` is a Cloudflare Pages Function
  deployed with the SPA, so the browser needs no CORS at all (`connect-src 'self'`). The host
  allowlist comes from the `GIT_PROXY_ALLOW` environment variable in the Pages project
  (comma-separated; unset = `github.com`, `gitlab.com`, `gitea.com`, `codeberg.org`).
  Wrangler picks `ide/functions/` up on its own because the deploy step already runs from
  `ide/`; no extra configuration or route file is needed.
- **A self-hosted deployment** — run the reference server and put it behind the same origin (or
  declare its URL):

  ```sh
  node scripts/dev/git-proxy.mjs --port 8787 --allow github.com,gitlab.acme.example
  ```

  then either reverse-proxy `/git-proxy/*` to it (keeps `"gitProxy": "same-origin"`) or set
  `projects.gitProxy` to `http://host:8787` / `https://git-proxy.acme.example` — a cross-origin
  proxy must also be listed in `network.connect` so the CSP allows it.

The proxy keeps no state: no storage, no cache, no cookies, and no per-request logging — only one
startup line. Request bodies are streamed, never read, and the `Authorization` header only passes
through. The allowlist is the security boundary: it must name the hosts the deployment may reach,
and loopback/private hosts must not be added (the proxy would become a path into its own network).
Because the token transits the proxy, run it on the deployment's own origin or in the company's
network; there is nothing to back up or clean up.

## 11. GitHub sign-in (device flow) in development (D-082)

The git dialogs offer "Sign in with GitHub" when the deployment configures an OAuth app. The
flow needs github.com through the same proxy, so the dev server is enough; there is no
callback URL and no secret.

1. Register an OAuth app once: GitHub → Settings → Developer settings → OAuth Apps → **New
   OAuth App**. Any name and homepage work; enable **Enable Device Flow** and leave the
   callback URL empty. Copy the client id (public, `Iv1.…`).
2. Point the build at a config that carries it:

   ```json
   { "schemaVersion": 1, "profile": "open",
     "projects": { "gitOAuth": { "github": { "clientId": "Iv1.0123456789abcdef" } } } }
   ```

   ```sh
   FACILIS_DEPLOY_CONFIG=/tmp/facilis-oauth.json pnpm ide:dev
   ```

3. For the hosted build, the same key goes into the deployment config the CI uses; the id is
   public, so it is not a secret. Without the key the button is absent and the dialogs keep
   asking for a token.

The token lives in the tab's memory only: a reload asks for a new sign-in, and **Sign out**
drops it. The device code is shown in the dialog, never logged; the OAuth calls are
`/git-proxy/github.com/login/device/code` and `/git-proxy/github.com/login/oauth/access_token`,
so the dev proxy's allowlist must contain `github.com` (the default does).
## 12. AI probe — live model cost and speed (`scripts/dev/ai-probe.mjs`)

A live probe for the IDE chat: it sends realistic feature requests to a real provider,
measures token consumption and latency, then runs the generated patches through the same
19-rule validator the chat uses and (optionally) typechecks them. It is **not part of the
gate** — it needs the network and a real key.

**Setup.** The key lives in the gitignored `ide/.env`, the same file Vite reads:

```sh
cp ide/.env.example ide/.env
# then set VITE_DEEPSEEK_API_KEY=... (and optionally VITE_DEEPSEEK_MODEL / VITE_DEEPSEEK_BASE_URL)
```

In dev the IDE seeds the DeepSeek preset from those variables (the D-045 settings, dev-only
and mode-gated), so the chat is configured on first boot without typing the key. Unset
`VITE_DEEPSEEK_API_KEY` to fall back to whatever the settings dialog saved. The value is
inlined into the dev bundle only, so never put a production key there.

**Run.**

```sh
pnpm ai:probe                                   # 5 tasks x 3 transport variants
pnpm ai:probe -- --tasks=route-stats,page-stats --configs=chat-default
pnpm ai:probe -- --prompt=golden --configs=flash-nothink
pnpm ai:probe:check /tmp/facilis-dev/ai-probe/<ts>/results.json
```

Each run writes `results.json` (per-call metrics and raw answers) and `summary.md` under
`/tmp/facilis-dev/ai-probe/<ts>/`. The checker applies each answer to a scratch copy of
`examples/todo-app` and runs the project's own `tsc`, which catches what the structural
validator cannot (wrong import paths, invented handler shapes, bad helper APIs).

**What it measures.** Time to first token, wall time, prompt/cache-hit/completion/reasoning
tokens, patch count, validator errors and warnings, and the off-peak dollar cost of the run.
Prompt variants exist to size the quality gap: `baseline` (the IDE prompt as shipped),
`conventions` (a short API-conventions addendum) and `golden` (the project's own route, page
and schema as few-shot examples). The probe caps output at 16k tokens; the IDE sends no
`max_tokens`, so a `finish_reason: length` here only says the answer was very long.

## 13. Publishing the framework packages — `@facilis.dev` (D-164)

The nine `packages/*` packages publish to public npm under the `@facilis.dev` organization scope.
`.github/workflows/publish-packages.yml` runs on every push to `main` that can change
`packages/**` — the same pushes that deploy the IDE — gates the published surface
(`turbo lint/typecheck/test/build --filter=./packages/*` plus `scripts/check-file-length.mjs`),
then stages and uploads each package.

Versions are derived, not committed: all packages release in lockstep on the next patch after the
highest version already on npm (`0.1.0` for the first release, the workspace stays at `0.0.0`), and
a half-failed release retries on a version no package has yet. The manifest that reaches npm is
staged by `scripts/publish-packages.mjs`: `exports` resolve to `dist/*.js`, internal deps are
pinned to the release version, `devDependencies`/`scripts` are dropped and test modules are
filtered out — publishing the workspace manifest directly is not installable.

**One-time setup.** Create a granular npm token with read/write on the `facilis.dev` organization
and store it as the `NPM_TOKEN` repository secret. The workflow fails before the first upload, with
a named error, when the secret is missing.

**Local rehearsal and manual release.**

```sh
pnpm publish:dry-run                                          # build, stage, npm publish --dry-run
pnpm publish:packages                                         # real publish (needs npm login on the org)
node scripts/publish-packages.mjs --version 0.2.0 --dry-run   # pin the version explicitly
```

`npm publish` inside a package directory is never right: the workspace `exports` point at
`src/*.ts` and the deps use `workspace:`, both of which npm rejects or resolves wrong. Trusted
publishing (OIDC) can replace the token after the packages exist.
