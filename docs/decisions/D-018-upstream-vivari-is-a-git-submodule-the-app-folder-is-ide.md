# D-018 — Upstream Vivari is a git submodule; the app folder is `ide/`
**Status:** accepted (2026-10-25); the submodule URL and branch are superseded by D-030

A copied tree is bad at the one operation that matters: staying aligned. `vendor/vivari` is a
**git submodule** (initially of `github.com/maitrungduc1410/vivari`, MIT, pinned at `1f00a48…`
/ tag `v1.1.2` with `branch = master`). D-030 moved it to our fork
`github.com/kele23/vivari`, pinned to `facilis/main`; the pin is a commit either way,
`git status` shows a single changed pointer, and nothing upstream is copied into our history.

The app folder is renamed `studio/` -> `ide/`: it is the Facilis IDE (the product is the IDE;
"Studio" was the upstream/vendor name), it starts as the full upstream `packages/studio` at the
pinned tag, and from there it is a fork that follows our conventions (D-019). The kernel is
consumed from the submodule by source: `@vivari/core` alias, `fs.allow` widened to the repo
root, and five deep imports — the complete patch set is in `ide/README.md` and
`vendor/README.md`.

**Consequences:** a fresh checkout needs `git submodule update --init vendor/vivari` before the
IDE typechecks (CI checks out submodules recursively); `vendor/` stays out of the pnpm
workspace and out of every gate; `ide/` **is** a workspace member (D-019).
