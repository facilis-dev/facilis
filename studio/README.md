# Facilis Studio

Facilis Studio is the browser IDE for Facilis: a VS Code-style app that runs a generated
Facilis project inside a WebContainer, where `vite dev` is the single dev server and
**Nitro v3 runs as a Vite plugin** (SPEC §10.6).

**Status: vendored, not yet modified for Facilis features.** This directory is an
MIT-licensed fork of upstream [Vivari](https://github.com/maitrungduc1410/vivari). The
upstream tree is kept as close to the original as possible so future upstream syncs stay
trivial; Facilis work goes into new modules (`ChatPanel`, `ApiFlowPanel`,
`DataExplorerPanel`, `ReleasePreviewPanel` — SPEC §10.2), not into rewrites of upstream
files.

- **Fork notes** — provenance, what is vendored/excluded, upstream sync procedure, runtime
  model, and verification results: [FACILIS.md](./FACILIS.md)
- **Upstream** — <https://github.com/maitrungduc1410/vivari>, pinned at commit
  `1f00a48c6d8009e7f369c1cf36959d61ad262b19` (branch `master`, 2026-10-16)
- **Upstream README** — unmodified copy: [UPSTREAM-README.md](./UPSTREAM-README.md)
- **License** — MIT, see [LICENSE](./LICENSE)
  (Copyright (c) 2026 Duc Trung Mai and Vivari contributors). Redistributed under the same
  license; the Facilis repository's root [LICENSE](../LICENSE) applies to Facilis code.

## Running it

Upstream expects **Bun** plus Rust/`wasm-pack` to build the Wasm crates, and a
cross-origin-isolated browser (COOP/COEP, `SharedArrayBuffer`) to run the WebContainer.
None of those exist in this sandbox; see [FACILIS.md](./FACILIS.md#7-verification-in-this-sandbox-2026-10-25)
for the exact commands that were attempted, what passed, and what is blocked.

## Where Facilis code will go

New Facilis panels and the `IdeController.applyPatch()` write path belong in new modules
under `packages/studio/src/` (writes through `kernel.writeFiles`, never OPFS directly —
SPEC §10.3). Do not edit upstream files unless there is no alternative; if a forced edit is
ever needed, record it in the "Local modifications" section of FACILIS.md.
