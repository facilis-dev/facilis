# Development environment

How to build, run and verify Facilis (including the browser IDE) on a bare machine.
Everything here is one command, reproducible, and needs **no root**.

The IDE runs the vendored Vivari kernel, which means four build artifacts that are
gitignored by upstream and therefore absent from a fresh checkout. `scripts/dev/` produces
them; this page is the contract for those scripts.

## TL;DR

```bash
git submodule update --init vendor/vivari   # once, from a clean clone
pnpm install

pnpm ide:wasm      # Rust -> Wasm kernel (vendor/vivari/packages/{vfs,codec,crypto}/pkg)
pnpm ide:assets    # ide/public/vendor/{npm-pack.bin,pnpm-pack.bin,sqlite/sqlite3.wasm}
pnpm ide:browser   # headless Chromium + shared libs + fonts (private sysroot, no root)

pnpm --filter @facilis/ide dev --host 0.0.0.0 --port 5173
pnpm ide:smoke     # headless acceptance: boot -> create React/TS project -> preview paints
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
| `npm-pack.bin` | real npm 10.9.2 (2.79 MB gz) | `/vendor/npm-pack.bin` |
| `pnpm-pack.bin` | real pnpm 9.15.9 (3.66 MB gz) | `/vendor/pnpm-pack.bin` |
| `sqlite/sqlite3.wasm` | SQLite wasm (865 KB) | `/vendor/sqlite/sqlite3.wasm` |

```bash
sh scripts/dev/vendor-assets.sh          # or: pnpm ide:assets
sh scripts/dev/vendor-assets.sh --all    # + yarn, corepack, tsgo, pyodide, ruff (needs host npm)
```

The generators write into `vendor/vivari/packages/studio/public/vendor` (gitignored, inside
the submodule); the script copies the results into `ide/public/vendor/` (also gitignored).

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
pnpm --filter @facilis/ide dev --host 0.0.0.0 --port 5173
```

- The dev server must send `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp` (they unlock `SharedArrayBuffer`); this is in
  `ide/vite.config.ts` and is asserted by the smoke test.
- Vite 8 rejects unknown `Host` headers. The sandbox forwards this app as `facilis.home`;
  `server.allowedHosts` allows it (override with `FACILIS_DEV_HOST`).
- In the UI: **Start from template -> React + TypeScript -> Create**. The IDE scaffolds the
  project in its VFS, runs `npm install` and then `npm run dev -- --configLoader native`, and
  opens the preview at `/preview/5173/`. `Start from blank` gives a project with only
  `package.json`; `Import a folder` / `Import from GitHub or npm` cover existing code.

## 5. Headless acceptance — `scripts/dev/smoke-ide.mjs`

```bash
pnpm ide:smoke                       # starts its own dev server (first free port from :5199)
node scripts/dev/smoke-ide.mjs --url http://127.0.0.1:5173/   # use a running server
```

It drives the real UI over the Chrome DevTools Protocol (`scripts/dev/cdp.mjs`, no npm
dependency) and asserts, in order: COOP/COEP headers, kernel online, home text rendered,
template picker opens, React/TypeScript listed and selectable, `Create` enabled, project
created, `preview-paint` boot mark, preview iframe mounted, preview answers `200` with HTML,
no page errors, no console errors, no failed requests. Exit code is non-zero on any failure.

Artifacts (screenshots + `report.json`) land in `SMOKE_ARTIFACTS`, default
`$FACILIS_TOOLING_DIR/smoke-artifacts/<epoch-ms>/`.

| Env var | Default | Meaning |
|---|---|---|
| `STUDIO_URL` / `--url` | start own server on `SMOKE_PORT` | target origin |
| `SMOKE_PORT` | `5199` | port for the self-started dev server |
| `SMOKE_ARTIFACTS` | see above | evidence directory |
| `TEMPLATE` / `LANGUAGE` | `React` / `TypeScript` | template to create |
| `BOOT_TIMEOUT_MS` / `PREVIEW_TIMEOUT_MS` | `180000` / `300000` | budgets |
| `FACILIS_CHROME` / `FACILIS_BROWSER_SYSROOT` / `FACILIS_FONTCONFIG` | from `browser/` | browser paths |

Reference runs on 16 cores (2026-10-25): kernel online **0.6 s** against an already-warm dev
server (**2.6 s** cold, when Vite is still transforming the 11k-line `templates.ts`), preview
painted **31-40 s** (in-VM `npm install` dominates), 16/16 checks green.

## 6. Known in-VM constraints

| Constraint | Effect | Handling |
|---|---|---|
| Vite 8 (rolldown) cannot start in the VM | `@rolldown/binding-wasm32-wasi@1.2.15` pins `@emnapi/core@2.0.0-alpha.5`, which `@napi-rs/wasm-runtime@1.2.6` rejects (`TypeError: Cannot set properties of undefined (setting 'initWorker')`); rolldown's webcontainer fallback re-installs the same broken set | **every Vite template is pinned to `vite@^7.1.0`** (verified: Vite 7.3.7 boots in 259 ms). Upstream fix is [rolldown#11292](https://github.com/rolldown/rolldown/pull/11292) — see §6.1 |
| No template locks / depcache | kernel logs `vendor/locks` + `vendor/depcache` warnings, installs from scratch (~25-45 s per project) | optional: run the upstream `vendor:locks` / `vendor:depcache` generators |
| `@rolldown/binding-wasm32-wasi` still listed in templates | ~14 MB of dead weight per install | kept so a future Vite 8 retry is a version bump, not a re-import |
| PGlite dev database is in-memory | resets on worker restart | Phase 1 caveat, see `docs/DECISIONS.md` |

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
- **Unblock checklist:** bump `rolldown` in the VM, revert `ide/src/vv/templates.ts` to
  `"vite": "^8.0.0"`, run `pnpm ide:smoke` (it asserts the preview document is the project),
  then delete this section and the note in `docs/DECISIONS.md` (D-021).
- **Verified interim patch (2026-10-25):** the generated project can pin the peer instead —
  `"overrides": { "@emnapi/core": "2.0.0-beta.2", "@emnapi/runtime": "2.0.0-beta.2" }` in the
  project's `package.json`. Tested in the VM: after `npm install` with that override,
  `vite 8.3.5` started (`ready in 803 ms`, port bound) and the preview painted. Pinning
  `@napi-rs/wasm-runtime` to `1.2.5` (which pairs with alpha.5) is the other way round.
  Not shipped in the templates: it is 17 one-line additions to the pinned
  `templates.ts` and upstream removes the need within days.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Blocked request. This host ("…") is not allowed.` | Vite 8 Host check | `FACILIS_DEV_HOST=<host> pnpm --filter @facilis/ide dev …` |
| UI renders but every text label is missing/blank | no system fonts for Chromium | `pnpm ide:browser`, or point `FACILIS_FONTCONFIG` at a `fonts.conf` |
| `[pnpm] load failed (Failed to fetch)` | `ide/public/vendor/pnpm-pack.bin` missing | `pnpm ide:assets` |
| `Cannot find native binding` when a project's dev server starts | the project uses Vite 8 / rolldown | see §6; create the project from a template (Vite 7) or pin `vite@^7` |
| `Could not resolve "../../../vfs/pkg/vivari_vfs.js"` | kernel wasm not built | `pnpm ide:wasm` |
| `Failed to resolve import "@vivari/core"` | submodule not checked out | `git submodule update --init vendor/vivari` |
| Port 5173 busy (`--strictPort`) | a previous dev server is still alive | `kill -TERM -- -<pgid>` (servers are started with `setsid`) |

## 8. Cleaning up

```bash
rm -rf /tmp/facilis-dev                    # toolchain + browser + smoke artifacts (~4 GB)
rm -rf ide/public/vendor                   # runtime assets (~7 MB, rebuilt by ide:assets)
rm -rf vendor/vivari/packages/*/pkg        # kernel wasm, rebuilt by ide:wasm
```
