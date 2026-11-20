# D-041 — A hostful `file:` URL is recovered in the engine's `fileURLToPath`, not worked around downstream
**Status:** resolved (2026-10-31) — fixed by the pin `e654919`

`TEMPLATE=Facilis` was green everywhere except one reporter's browser, where every project's
database died at dev-server boot:

```
TypeError: File URL host must be "localhost" or empty on posix
  [diagnostic: file://home/user/projects/x/node_modules/@electric-sql/pglite/dist/pglite.data]
```

The module id was correct: the loader compiled PGlite from
`/home/user/projects/x/node_modules/@electric-sql/pglite/dist/index.cjs` and `__filename` was
that absolute path (probed in the VM: `[pglite-probe] "/home/…/index.cjs" "file://home/…/index.cjs"`).
PGlite's CJS build locates its artifacts with `new URL("file:" + __filename)` — i.e. `file:/home/…`.
Node and Chromium on POSIX read that as an empty-host file URL (`file:///home/…`). **Chromium's
file-URL parser is platform-dependent** (`url/url_parse_file.cc`: on WIN32 anything that is not a
drive spec and does not have exactly three slashes is parsed as a UNC path, so the first path
segment becomes the **host**), so on Windows the URL is `file://home/…` with pathname
`/user/…`, and the fork's strict `fileURLToPath` (D-039) refuses it, loudly.

**Interim decision (2026-10-31, removed):** `@facilis.dev/db` read the three artifacts beside the
resolved CJS entry (an absolute VFS path, no URL parsing) and passed them to PGlite:
`fsBundle` (the `pglite.data` bytes as a `Blob`), `pgliteWasmModule` and
`initdbWasmModule` (`WebAssembly.Module`), so the database no longer depended on how a
browser parses a `file:` URL. That could not be the end state: PGlite's Emscripten glue calls
`require("url").fileURLToPath(A)` during its own init, **before any option is consulted**, so
the boot still died in the runtime — and every other userland `"file:" + __filename` idiom in
the VM would die the same way.

**Update (2026-10-31, confirmed):** the platform dependence is in Chromium itself, not in the
browser version: Chrome `156.0.0.0` on Windows parses `new URL("file:/home/user/x")` as
`file://home/user/x`, the same version on Linux as `file:///home/user/x` (Node 24 agrees with
Linux). Chromium's `url/url_parse_file.cc` documents the WIN32 branch — "Anything not beginning
with a drive spec (\"c:\\\") on Windows is treated as UNC, with the exception of three slashes
which always means a file" — while the POSIX branch only gives a host to exactly two slashes.
The same parser also turns a relative module id into a host, i.e. D-039 is platform-specific
on Windows, and upstream's lenient `fileURLToPath` would silently return `/user/…` there.

**Decision:** the fix belongs in the runtime's `fileURLToPath`, because a host in a `file:`
URL of this VFS can only be the first path segment a browser's parser promoted; a host cannot
mean a file host. The fork's `e654919` (**kele23/vivari#2**, the issue carries the Chromium
evidence) recovers `"/" + hostname + pathname`, with no join for a bare `/` pathname
(`file:/home` parses as host `home` + pathname `/`, and the intended path is `/home`, not
`/home/`), in `packages/runtime/node/internal/url.js` and `Bun.fileURLToPath` — plus
`Bun.file(URL)`, which now shares the rule through `createBunFile` instead of stripping a
`file://` prefix into a relative path. Three-slash URLs, `localhost` and the non-file-scheme
error are unchanged; the one deliberate deviation from Node is that a real UNC URL maps to
`/server/share` instead of throwing. With that pin, `@facilis.dev/db` is back to the plain
constructor (`new PGlite({ dataDir })`): the artifact hand-off and the one-boot recovery shim
are deleted, and the database locates its own `.data`/`.wasm` again.

**Update (2026-11-13, pin `0a1eea1`):** the recovery is now upstream's — the fix merged as
PR #35 and ships in upstream `v1.2.1`, and `facilis/main` was realigned onto `v1.3.0` +
15 fork commits. The behaviour is unchanged (the rule now lives in `runtime/file-url.js`),
and `@facilis.dev/db` still uses the plain PGlite constructor.

**Consequences:** DB boot is independent of the browser's URL parser *and* of any downstream
shim, and the fix covers every hostful `file:` URL in the VM (PGlite, any other Emscripten
module, `Bun.file`), where the shim covered one boot of one library. Acceptance: `pnpm test`
(db), the gates, and `TEMPLATE=Facilis pnpm ide:smoke` with
`facilisDbInsert`/`facilisDbQuery` = ok; a project created before the bump keeps working,
because the runtime — not the `@facilis.dev/db` tarball — carries the fix.
