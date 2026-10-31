# Upstream Vivari work

Our fork is [`kele23/vivari`](https://github.com/kele23/vivari) (upstream
[maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari), MIT). `master` mirrors
upstream and carries no commits of ours; **`facilis/main` = upstream tag + the fixes below and
is what `vendor/vivari` pins** (D-030). The five upstream fixes were proposed as PRs and merged
(released in v1.1.5); the `fix/*` branches stay at their pre-merge commits as a record. The pin
then moved to upstream `v1.2.0` (the `node:sqlite` release), with three further fixes proposed
as PRs #29–#31 and carried by the fork until they merge. A fourth runtime fix — recovering the
path from a hostful `file:` URL (fork issue
[#2](https://github.com/kele23/vivari/issues/2), the PGlite boot failure in D-041) — is
**fork-only for now**: it waits for the upstream `fix/file-url-host-v2` PR the maintainer
asked for after reverting #31, and `facilis/main` carries it as `e654919`.

| Branch | Fix | Base | Upstream PR |
|---|---|---|---|
| `facilis/main` | integration: upstream `v1.2.0` (`9c87dec`) plus the nineteen Facilis-driven commits below; pin `e654919` | `v1.2.0` | — |
| `fix/runtime-esm-only-targets` | ESM-only package copies vs the require-first resolver (D-024) | `v1.1.4` | [#19](https://github.com/maitrungduc1410/vivari/pull/19) |
| `fix/opfs-mirror-priority` | OPFS mirror: project paths ahead of package-manager caches, manifest written while draining (D-028) | `v1.1.4` | [#21](https://github.com/maitrungduc1410/vivari/pull/21) |
| `fix/import-meta-resolve-url` | `import.meta.resolve` returns a URL, not a path | `v1.1.4` | [#20](https://github.com/maitrungduc1410/vivari/pull/20) |
| `fix/opfs-crosstab-index` | OPFS mirror index: merged per tab under a Web Lock, replaced through a staged copy (D-033) | `v1.1.4` | [#22](https://github.com/maitrungduc1410/vivari/pull/22) |
| `fix/preview-per-tab-kernel` | Preview requests routed to the kernel that owns the frame (`clientId`/`resultingClientId`), per-kernel keep-prefix + tunnel frames (D-033) | `v1.1.4` | [#23](https://github.com/maitrungduc1410/vivari/pull/23) |
| `fix/file-url-host` | A relative module id must never become a file URL's **host**: `import.meta.url`, `Bun.pathToFileURL` and the debugger's script URLs are built from an absolute path, and `fileURLToPath` throws Node's `ERR_INVALID_FILE_URL_HOST` (fork issue #1, D-039) | `v1.2.0` | [#31](https://github.com/maitrungduc1410/vivari/pull/31) |
| `fix/esm-comment-after-export` | The ESM→CJS transpiler advances over comments between `export` and its declaration (zod v4's `export /*@__NO_SIDE_EFFECTS__*/ function`, found by the Facilis probe) | `v1.2.0` | [#29](https://github.com/maitrungduc1410/vivari/pull/29) |
| `fix/vendor-stale-pack-version` | Both packers rebuild a pack whose stamped version no longer matches the pin instead of silently reusing it (D-032) | `v1.2.0` | [#30](https://github.com/maitrungduc1410/vivari/pull/30) |

All five fixes were **merged upstream** on 2026-10-31 (#19–#23) and released in
`v1.1.5` (`2f461da`), together with the maintainer's follow-up commits, which closed every
review request: `spike-resolve-fallback.mjs` for #19; builtin-only `node:` and
`pathToFileURL` escaping for #20; the drain-priority rules in `AGENTS.md`/`roadmap.md` for #21;
the index batch/lock fixes plus `spike-opfs-multitab.mjs` (with `scripts/lib/fake-opfs.mjs`)
for #22; and the per-boot **kernel token** in same-origin preview URLs, routing-map pruning,
`spike-sw-multitab.mjs` and the `spike-sw-routing.mjs` repair for #23. Those upstream versions
are the base of the pin now; the `fix/*` branches below remain at their pre-merge commits as a
record.

Three further fixes are **open upstream** on the `v1.2.0` base, carried by the pin until they
merge: #29 (the comment-between-tokens transpiler fix), #30 (the stale-pack rebuild) and #31
(the file-URL host bug of fork issue [#1](https://github.com/kele23/vivari/issues/1), which is
what killed PGlite's ESM build in the preview — D-039 in the superproject). Upstream `v1.2.0`'s
own CI is red in the `ci-tiers` spike, so the open PRs inherit a red base that is not theirs
(fork record: `FORK.md`).

`e654919` is the runtime half of the same story as #31, on the opposite side: a `file:` URL
whose first path segment a browser promoted to the **host** (Chromium's `url/url_parse_file.cc`
has a WIN32 UNC branch, so `"file:" + "/home/user/x"` is `file://home/user/x` on
Chrome/Windows) is converted back to the path it means instead of throwing
`ERR_INVALID_FILE_URL_HOST`. `Bun.fileURLToPath` and `Bun.file(URL)` follow the same rule; a
three-slash URL, `localhost` and the non-file-scheme error are unchanged. It is fork-only by
decision (FORK.md: a deviation from Node on posix) and belongs in the re-opened
`fix/file-url-host-v2` PR; downstream, it is D-041 and it removed the workaround that
`@facilis/db` carried.

The pin was realigned from `v1.1.3` to `v1.1.4` on 2026-10-29 and from `v1.1.4` to `v1.1.5`
on 2026-10-31. The second realignment dropped the five merged fixes from `facilis/main` (their
upstream commits, with the follow-ups, carry them) and replayed the eight Facilis-only commits on
top of the tag; one conflict (the manifest lock that both #22's follow-up and D-036 touch) was
resolved by keeping both: `restore()` and the new `hydrate()` read the index under
`vv-vfs-manifest`, `materialize()` after the lock.

A third realignment moved the pin from `v1.1.5` to `v1.2.0` (`9c87dec`) on 2026-10-31, the same
recipe: the fork delta (now nineteen commits) replayed on the tag. `packages/studio` is identical
at the two pins, so the studio sources did not move; `packages/{runtime,protocol,core,kernel-host}`
did, and the reverted `e2f4246` moved the Facilis tarball delivery into the create message
(D-032 in the superproject).

Multi-tab (D-033 in the superproject) is what the last two fixes are for: the IDE runs one
project per browser tab, so two kernels share one origin, one preview proxy and one OPFS mirror.

The other commits on `facilis/main` are not `fix/*` PR branches: the vendored npm is pinned
to 12.2.1, both packers now rebuild a
pack whose stamped version no longer matches the pin instead of silently reusing it, pnpm's
own config (`store-dir`, `package-import-method`, and v1.1.4's `strict-store-pkg-content-check`)
moved from the base process environment into the pnpm shim — npm 12 warned `Unknown env config`
for the first two on every install (D-032 follow-up) — the OPFS boot restore can be scoped
so a tab replays the project it opens instead of every project on the origin
(`BootOptions.deferRestoreRoots`, D-036), package-manager cache **bodies** can stay in the
mirror too, replayed one at a time by the FS worker the first time a syscall reads them
(`BootOptions.deferCacheFiles`, D-037), the ESM→CJS transpiler advances over comments between
`export` and its declaration (zod v4's `export /*@__NO_SIDE_EFFECTS__*/`, found by the Facilis
probe), and `hydrate()` reads the shared index under the manifest lock like `restore()` does.
`e2f4246` (a template shipping binary assets the kernel fetches) is **reverted** by the
realignment: it existed only for the downstream `file:` tarball install, so the Facilis IDE
passes the bytes through the create message's `files` instead (D-032 in the superproject). The
rest are the fork's own records (`FORK.md`, the policy and realignment notes).

The five merged fixes are `git am`-able next to this file (`vivari-*.patch`, with their PR bodies
in `vivari-*-pr.md`) so they can be replayed without the fork; the three open PRs live as the
`fix/*` branches above and are recorded in the fork's `FORK.md` — the hostful-`file:` recovery
has no branch yet, it waits for the re-opened `fix/file-url-host-v2` PR. Evidence and the negative
results are in [`vivari-findings-2026-10-28.md`](./vivari-findings-2026-10-28.md).

## Workflow

- **New fix:** branch from the fork's `master` (after `git -C vendor/vivari fetch upstream
  --tags`), commit with a changeset, run upstream's offline tiers if it is runtime-side, open
  the PR from the fork to `maitrungduc1410/vivari:master`, then merge the commit into
  `facilis/main` and bump the submodule pin here (D-030).
- **Upstream release:** fetch the new tag in the fork (a fresh clone adds the upstream remote
  once: `git -C vendor/vivari remote add upstream https://github.com/maitrungduc1410/vivari.git`),
  rebase every `fix/*` onto it, force-push the branches and `facilis/main`, then
  `TEMPLATE=Facilis pnpm ide:smoke` here and bump the pin.
- **Fix merged upstream:** drop its commit from `facilis/main` (rebase), point the pin at the
  release that carries it, delete the branch. The `.patch` artifacts stay as a record.
- **Never** edit the submodule worktree, and never pin a branch head — always the commit.

## Status notes

- The `facilis.home` install failures are **not** upstream work: nginx retires an HTTP/2
  connection after 1000 requests and middleware-mode dev crossed that boundary several times per
  run (D-029). The IDE now avoids it by serving the dev app in Vite's full-bundle mode (D-031);
  the proxy fix is still worth applying but is no longer on the critical path.
- `Kernel: throttle concurrent Process Worker boots` was validated and then **dropped** — it
  reduced concurrency but not request volume, so it only shifted the probability. D-031 removes
  the volume itself (a worker no longer loads a 190-request graph in dev). The branch is gone; do
  not re-add it.
