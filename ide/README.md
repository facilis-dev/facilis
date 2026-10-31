# Facilis IDE

The Facilis IDE is the browser IDE for Facilis: a VS Code-style app that runs a generated
Facilis project inside a WebContainer, where `vite dev` is the single dev server and
**Nitro v3 runs as a Vite plugin** (SPEC §10.6).

**It starts from the current Vivari Studio** — upstream `packages/studio` at tag `v1.1.2`
(commit `1f00a48c6d8009e7f369c1cf36959d61ad262b19`), imported in full — **and forks from
here.** The kernel is the [`vendor/vivari/`](../vendor/vivari) submodule of our Vivari fork,
pinned to `facilis/main` (upstream `v1.2.0` + the fixes we carry; D-030): it is never edited
in the worktree, only bumped to a fork commit ([`vendor/README.md`](../vendor/README.md),
branch map in [`docs/upstream/README.md`](../docs/upstream/README.md)).

| | |
|---|---|
| Upstream repository | <https://github.com/maitrungduc1410/vivari> |
| Upstream tag / commit | `v1.1.2` / `1f00a48c6d8009e7f369c1cf36959d61ad262b19` (branch `master`, 2026-10-16) |
| App source | upstream `packages/studio/` |
| Kernel | our fork [`kele23/vivari`](https://github.com/kele23/vivari), pinned at `facilis/main` = upstream `v1.2.0` + 19 fork commits (`e654919`, D-030) |
| License | MIT — [`LICENSE`](./LICENSE) (Copyright (c) 2026 Duc Trung Mai and Vivari contributors); Facilis code is covered by the root [`LICENSE`](../LICENSE) |

## Layout

```
ide/                        # this app — the fork surface
├── src/                    # editor UI, IdeController (src/vv), panels
├── public/                 # static assets (SW, DevTools shims)
├── index.html
├── vite.config.ts          # COOP/COEP, Monaco/xterm/DevTools middleware, kernel aliases
├── tsconfig*.json          # strict TypeScript, repo config
└── package.json            # @facilis/ide — a pnpm workspace member
```

## UI rules: dark mode + i18n (D-043)

- **Strings.** Everything user-facing goes through `t()` from `ide/src/i18n`; the text lives
  in `ide/src/i18n/en.ts` and `ide/src/i18n/it.ts` (partial Italian is fine — missing keys
  fall back to English). The runtime is `@facilis/core/i18n` imported via its subpath, so the
  static SPA does not bundle the framework. `initI18n()` runs before the first render and sets
  `<html lang>`.
- **Themes.** next-themes drives `.dark` (`attribute="class"`); use the semantic tokens
  (`bg-background`, `bg-sidebar`, `bg-card`, `bg-accent`, `text-foreground`,
  `text-muted-foreground`, `border-border`, …) so one class flips a surface. Raw palette
  colours are only for brand marks and scrims, with a comment. The user picks Light / Dark /
  System in the command palette; Monaco and xterm follow `applyUiTheme()`.
- **Retrofit.** Upstream-inherited chrome is migrated file by file as it is touched; the
  checklist is [`I18N.md`](./I18N.md). New UI (ChatPanel and the Phase 3 panels) lands
  compliant in its first commit, and `pnpm --filter @facilis/ide test` enforces the catalogue
  parity.

## Repo conventions apply here

The IDE is a **workspace member** and is held to the same rules as the framework packages
(AGENTS.md): TypeScript **strict**, the repo **oxlint** config (`-c ../.oxlintrc.json`, the
upstream per-app config was removed), repo **Prettier** (print width 100 — the whole tree was
formatted once when the fork started), vitest tests, and the 300-line limit with one
exception described below. Gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
`pnpm format:check` from the repo root; per-package `pnpm --filter @facilis/ide <script>`.

**300-line ratchet:** fourteen files inherited from upstream are above the limit
(`templates.ts` 11.4k lines of template payloads, `controller.ts` 3.0k and falling, ten
components, `vite.config.ts`). They are recorded in [`scripts/file-length-baseline.json`](../scripts/file-length-baseline.json)
at their import size; the check is a ratchet — a listed file may shrink but not grow, entries
must be deleted once a file drops under 300 lines, and no new file may be added. Splitting them
(staring with `controller.ts`) is the Phase 2 refactor, in progress: each subsystem moves
into its own session module behind a small host interface (D-042). New IDE code obeys 300 lines
immediately.

## Local modifications vs upstream (the complete patch set)

1. `package.json`: name `@facilis/ide` (+ description), repo scripts (`build` = `tsc -b`,
   `build:app` = full `vite build`, `typecheck`, `lint`, `test`), tool versions from the repo
   catalog (TypeScript 7, oxlint, vitest); dropped upstream `bun.lock` and `.oxlintrc.json`.
2. `vite.config.ts`: `@vivari/core` alias -> `../vendor/vivari/packages/core/src/index.ts`;
   dev-server `fs.allow` widened to the repository root (the kernel lives outside this folder).
3. `tsconfig.app.json` / `tsconfig.node.json`: the same `@vivari/core` mapping and
   `"strict": true`.
4. Five deep imports in `src/vv/` (`controller.ts`, `import-remote.ts`,
   `python-language.ts`) point at `../../../vendor/vivari/packages/{kernel-host,runtime}`.
5. Formatting: the tree is formatted with the repo Prettier config (mechanical, no behaviour
   change). Keep it formatted; do not re-run upstream's formatter.
6. Fourteen files above 300 lines, recorded in the file-length baseline (see above).
7. `src/vv/templates.ts`: every Vite template resolves `vite@^7.1.0` instead of upstream's
   `^8.0.0` — Vite 8's rolldown cannot load its wasm binding inside the VM (see "Running it").
8. `public/sw.js`: carries the **per-kernel preview routing** (D-033), now upstream's own
   (upstream #23 + its follow-up, released in v1.1.5): a same-origin preview URL carries the
   kernel's per-boot token, the SW records the frame against that tab and redirects the token
   away, and the routing maps are pruned. The IDE serves its own copy of the upstream Service
   Worker, so a change there is made in `vendor/vivari/packages/studio/public/sw.js` first and
   mirrored here — keep the two in sync (the IDE copy is mirrored through the repo's Prettier,
   with `catch {}` and a `Set` for the isolation policies to satisfy our lint).
9. **Multi-tab** (D-033): Home's recent-project row moves to
   `src/components/ide/RecentProjectsRow.tsx` so it can grow an "Open in a new tab" action
   without pushing `Home.tsx` past its baseline; `src/vv/project-tabs.ts` +
   `src/vv/project-lock.ts` own the `?project=` bootstrap and the one-project-per-tab claim;
   `src/vv/project-registry.ts` read-merge-writes Home's recent list (a tab must not drop
   another tab's project) and `src/vv/project-name.ts` derives the label from the folder name
   (D-035); `IdeProvider` installs the tab modules and `TitleBar` gains a "New tab" button.

Everything else is byte-identical to upstream at the pinned commit (`diff -r` with
`vendor/vivari/packages/studio` shows exactly the files above).

## Running it

The IDE runs on the vendored kernel, so four gitignored build artifacts must exist first.
`docs/DEV.md` is the full guide (why each step exists, versions, troubleshooting); the short
version:

```bash
git submodule update --init vendor/vivari   # once, from the repo root
pnpm install                                # repo install links the IDE (workspace member)

pnpm ide:wasm        # Rust -> Wasm kernel: vendor/vivari/packages/{vfs,codec,crypto}/pkg
pnpm ide:assets      # ide/public/vendor/{npm,pnpm}-pack.bin + sqlite/sqlite3.wasm
pnpm ide:browser     # headless Chromium + libs + fonts (no root, private sysroot)

pnpm ide:dev         # vite dev on 0.0.0.0:5173, COOP/COEP headers
pnpm ide:smoke             # headless acceptance: boot -> create React/TS project -> preview paints
pnpm ide:smoke:multitab    # two tabs, two projects, one kernel each (D-033)
```

Verified 2026-10-25: kernel online **572 ms**, project created, `npm install` inside the VM,
Vite 7 dev server on 5173, preview painted **31 s** — 16/16 smoke checks green (screenshots and
`report.json` under `$FACILIS_TOOLING_DIR/smoke-artifacts/`). `build:app` (full `vite build`)
is not part of that pass yet.

**Several projects at once (D-033):** a browser tab is the unit — one project per tab, one
kernel per tab, the same project cannot be open twice. Opening a project is close-on-open
(D-035): `openFolder()` closes the tab's other roots first, so a tab never shows two projects,
and a project's label is its directory name — `projectName(rootPath)` is the only source for
the Explorer root, title bar, browser title and Home rows. A tab opened from another one
carries `?project=<rootPath>` and reopens (and runs) that project on reload; Home's rows and the
title bar open new tabs; the browser title uses the project's directory name so tabs are
distinguishable.
Measured on 16 cores: two tabs with one React and one Vue project cost ~355 MB + ~362 MB of
worker memory and the second tab boots **+2.5-2.9 s** (it restores the shared tree); both dev
servers bind 5173 in their own VM, which is why the preview Service Worker routes per preview
frame rather than per port. `pnpm ide:smoke:multitab` is the acceptance run (~4 min).

**In-VM constraint (why the templates pin Vite 7):** Vite 8 bundles with rolldown, whose
WebAssembly binding (`@rolldown/binding-wasm32-wasi@1.2.15`) pins `@emnapi/core@2.0.0-alpha.5`,
which `@napi-rs/wasm-runtime@1.2.6` rejects with
`TypeError: Cannot set properties of undefined (setting 'initWorker')`; rolldown's own
"download the binding" fallback re-installs the same broken set, so `vite` never binds a port.
All Vite templates therefore resolve `vite@^7.1.0` (Vite 7.3.7 boots in 259 ms in the same VM).
The `@rolldown/binding-wasm32-wasi` entries are kept so retrying Vite 8 later is a version bump.
Upstream is on it: [rolldown#11292](https://github.com/rolldown/rolldown/pull/11292) (2026-10-25)
moves the binding to `@emnapi/core@2.0.0-beta.2`; Vite depends on `rolldown ~1.2.14`, so the
next rolldown patch release fixes Vite 8 without a Vite bump. An interim per-project
`overrides` pin was verified to boot Vite 8.3.5 (803 ms) — see `docs/DEV.md` §6.1 for the
unblock checklist. Details and the rest of the environment notes: [`docs/DEV.md`](../docs/DEV.md).

## Where Facilis code goes

New Facilis panels and the `IdeController.applyPatch()` write path belong in new modules under
`ide/src/` (writes go through `kernel.writeFiles`, never OPFS directly — SPEC §10.3). Upstream
files are formatted/linted but not otherwise rewritten; forced edits go into the patch set above.

The first Facilis module is `ide/src/facilis/`: the probe template that boots a real Facilis
app in the WebContainer (`facilis()` mounts Nitro + PGlite + `/__facilis/*`). The generated
project has **one config**, `facilis.config.ts`: its `nitro` section carries the WebContainer
constraint `devServer: { runner: "self" }` (Nitro's default node-worker runner needs
`worker_threads` and a file-URL `import.meta.resolve`, which the VM does not provide), there
is no `nitro.config.ts`, and `vite.config.ts` never imports Nitro (D-034). The probe also
drives a full database roundtrip — register, log in, `POST /api/todos`, read the list back —
and reports it to the smoke as `facilisDbInsert`/`facilisDbQuery`: PGlite, the migrations and
the authorized-handler stack only prove themselves inside the VM, not in Node. Its
`package.json` pins `@types/react`/`@types/react-dom` 19.3.0 because Monaco's TypeScript
service only sees
installed `@types/*.d.ts` — without them the editor reports TS2307 on `react`. It is
registered by merging the catalog in `src/vv/templates-lazy.ts` — `src/vv/templates.ts` sits
at its file-length baseline and may not grow. The generated project installs with **npm**
(D-032): the `@facilis/*` tarballs are inlined into the create request (the manifest's
`assets`, fetched same-origin by the IDE) and land in the project's `./vendor`, declared as
`file:` dependencies,
so no install reaches the studio over HTTP and the project stays installable outside the IDE.
The npm version is pinned in lockstep with the VM's Node — `NPM_VERSION` in
`scripts/dev/vendor-assets.sh` must equal the template's `packageManager`, and
`ide/src/facilis/package-manager.test.ts` enforces it. The constraints and the upstream bugs
behind them are recorded in `docs/DECISIONS.md` D-022…D-024, D-032, D-034 and summarized in
`docs/DEV.md` §6.
