# D-039 — PGlite is loaded from its CJS build, never its ESM build
**Status:** accepted (2026-10-31)

Opening a preview in the IDE killed the whole database: `/api/auth/session` answered
`{"code":"db_unavailable"}`, the probe's insert and query failed the same way, and the in-VM dev
server printed

```
ENOENT: no such file or directory, open
  '/user/projects/facilis-ts-app2/node_modules/@electric-sql/pglite/dist/pglite.data'
```

— the path had lost its `/home`. PGlite finds `pglite.wasm`/`pglite.data` next to its own module;
its ESM build does that with `new URL('./pglite.data', import.meta.url)`, and the in-VM loader
synthesises `import.meta.url` from the module id it was handed. A non-absolute id turns
`"file://" + id` into `file://home/…`, where the first path segment parses as the URL **host**:
`fileURLToPath` then yields `/user/projects/…`, outside the tree. Its CJS build resolves the
same artifacts from `__filename`, which stays an absolute VFS path.

**Decision:** `@facilis.dev/db` loads `@electric-sql/pglite` through `createRequire` — the CJS build
— instead of an ESM `import` (resolved from this module's URL first, the project root second).
That is also the vendor's documented in-VM rule (`vendor/vivari/AGENTS.md`, "In-VM databases"):
PGlite must be required via its CJS build.

**Update (2026-10-31, pin `97d90ab`):** the vendor fixed the URL construction itself —
`9184ee5` builds `import.meta.url` from an absolute module id and `fileURLToPath` now throws
Node's `ERR_INVALID_FILE_URL_HOST` instead of silently converting a hostful URL (fork issue
[#1](https://github.com/kele23/vivari/issues/1), upstream PR #31) — so the malformed URL can no
longer be produced. The CJS load stays: the in-VM database rule has a second, independent reason,
"only the ENTRY module can block on top-level await in-VM", so an ESM import of a TLA-bearing
dependency from a non-entry module can hang.

**Update (2026-10-31, pin `e654919`):** a hostful `file:` URL is no longer fatal either: the
runtime's `fileURLToPath` (and `Bun.fileURLToPath`) now converts `file://home/…` back to
`/home/…` instead of throwing, because a browser can promote the first path segment of
`"file:" + path` to the host (Chromium on Windows) — see D-041. The CJS load stays, for the two
reasons above.

**Consequences:** the database no longer depends on a well-formed `import.meta.url` in the
server bundle, so a rewritten or relative module id cannot take it down; the ESM build stays
unused. Acceptance: `pnpm test` (db), the root gates, and `TEMPLATE=Facilis pnpm ide:smoke` with
`facilisAuth`/`facilisDbInsert`/`facilisDbQuery` = ok (57/57 verified).
