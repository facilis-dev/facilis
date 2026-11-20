# D-021 — The IDE dev environment is scripted, and the browser path is verified
**Status:** accepted (2026-10-25)

The IDE can only run when four artifacts exist, all of them gitignored upstream build outputs:
the kernel's Rust->Wasm `pkg/` dirs, the kernel's real-CLI assets (`npm-pack.bin`,
`pnpm-pack.bin`, `sqlite3.wasm`), and a browser with system fonts. They are produced by
`scripts/dev/` (`build-kernel-wasm.sh`, `vendor-assets.sh`, `fetch-browser.sh`) and exercised
by `scripts/dev/smoke-ide.mjs`, wired as `pnpm ide:wasm`, `ide:assets`, `ide:browser`,
`ide:dev`, `ide:smoke`. The recipe, pinned versions and troubleshooting are
[`docs/DEV.md`](./DEV.md); the scripts must stay the only way in.

**Context:** the target sandbox has no root, no writable `$HOME`, no `cc`, no `xz`, no
browser and no fonts, but it does have network. Reproducing upstream's pipeline therefore
means: Zig as the host linker for Rust build scripts, a prebuilt `wasm-bindgen` seeded into
wasm-pack's cache, npm/pnpm tarballs extracted instead of installed, and Chromium + its .deb
dependency closure unpacked into a private sysroot with a generated `fonts.conf`. Without
fonts, Chromium measures zero-height line boxes: the UI renders blank and even `innerText`
is empty.

**Consequences:** the browser path is proven — kernel online 572 ms, project created, in-VM
`npm install`, dev server bound, preview painted at 31 s, 16/16 smoke checks; evidence under
`$FACILIS_TOOLING_DIR/smoke-artifacts/`. **All Vite templates now resolve `vite@^7.1.0`
instead of upstream's `^8.0.0`**: Vite 8's rolldown wasm binding pins
`@emnapi/core@2.0.0-alpha.5`, which `@napi-rs/wasm-runtime@1.2.6` rejects
(`TypeError: Cannot set properties of undefined (setting 'initWorker')`), and rolldown's
webcontainer fallback reinstalls the same broken set. Vite 7.3.7 boots in 259 ms in the same
VM. Upstream fix: [rolldown#11292](https://github.com/rolldown/rolldown/pull/11292)
(opened 2026-10-25) moves the wasi binding to `@emnapi/core@2.0.0-beta.2`; rolldown releases
weekly and Vite 8 depends on `rolldown ~1.2.14`, so the next rolldown patch release unblocks
Vite 8 with no Vite bump — then the templates go back to `^8.0.0` and `pnpm ide:smoke` is the
gate (`docs/DEV.md` §6.1). The `@rolldown/binding-wasm32-wasi` entries stay in the templates so
the retry is a version bump. `build:app` (the IDE's full
`vite build`) is still not part of the pass. This unblocks the Phase 0 browser items A1-A3,
A6 and A8-A12 that were waiting on a harness.
