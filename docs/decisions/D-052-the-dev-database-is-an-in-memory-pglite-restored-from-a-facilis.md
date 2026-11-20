# D-052 — The dev database is an in-memory PGlite restored from a .facilis snapshot
**Status:** accepted (2026-11-01)

PGlite runs in memory and was thrown away on every Nitro worker restart — i.e. on every
edit to a server route — so the dev loop was "register a user, change a handler, lose the
session and the data". `dataDir` was not wired (D-015). Two persistence shapes were measured
on PGlite 0.5.11 first: a real data directory (NodeFS) is ~978 files / ~40 MB for an empty
cluster, so it would cross the VFS/OPFS mirror per file and replay on every project open;
`dumpDataDir("gzip")` is one ~4.6 MB archive (~300 ms on the host) and
`PGlite.create({ loadDataDir })` restores it in ~200 ms.

**Decision.** Keep the cluster in memory and persist one snapshot at
`<project>/.facilis/db/snapshot.tar.gz`. On boot the runtime reads it (if present) and
passes it to `createDb({ loadSnapshot })`; `@facilis.dev/db` exposes `snapshot()` and a
monotonic `activity()` count, and `@facilis.dev/nitro` installs a snapshotter that dumps only
when the cluster changed, from a 1 s ticker, and writes atomically (temp + rename).
Migrations are tracked by statement hash (`migrator.ts`), so a restored cluster re-applies
only new migrations. A corrupt or incompatible snapshot is a manifest warning and the
runtime starts empty rather than refusing to boot.

**Ignoring it.** `.facilis` is dev state, not source: it is dimmed in the Explorer (D-054),
kept out of the file index and search, excluded from export/share, and the runtime writes a
`.facilis/.gitignore` containing `*` so git ignores it even in projects whose own
.gitignore predates the directory.

**Consequences and limits.** At most ~1 s of writes can be lost if the process is killed
abruptly; a dev-server restart restores the last snapshot. Production is unaffected (real
Postgres). The snapshot is per project, so deleting the project removes it (D-050) and
"reset the database" is deleting the file.

**Verification.** `client.test.ts` round-trips `snapshot()`/`loadSnapshot` and pins
`activity()`; `dev-db-persistence.test.ts` pins the atomic write, the no-dump-on-idle rule
and `.facilis/.gitignore`; `pnpm ide:smoke` asserts the snapshot exists after DB activity
inside the WebContainer.
