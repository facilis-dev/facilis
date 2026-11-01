// Studio's bridge to the kernel worker (the vendored fork of Vivari's runtime, D-030).
//
// The transport, the worker (and its nested fs/fetcher/process workers), the
// Rust/Wasm VFS, and the preview Service Worker relay all live in `@vivari/core`
// now — Studio is just the first (and richest) consumer of that SDK. This file
// is a thin re-export of the core surface Studio needs. VFS whole-file lazy
// compression is always on (the core boot default); the "reset everything" flow
// lives in origin-reset.ts, which owns the whole per-origin clean slate.

export { KernelBridge, isCrossOriginIsolated } from "@vivari/core";
export type { KernelMessage } from "@vivari/core";
