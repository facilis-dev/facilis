# Facilis IDE

The Facilis IDE is the browser IDE for Facilis: a VS Code-style app that runs a generated
Facilis project inside a WebContainer, where `vite dev` is the single dev server and
**Nitro v3 runs as a Vite plugin** (SPEC §10.6).

**It starts from the current Vivari Studio** — upstream `packages/studio` at tag `v1.1.2`
(commit `1f00a48c6d8009e7f369c1cf36959d61ad262b19`), imported in full — **and forks from
here.** The kernel is the [`vendor/vivari/`](../vendor/vivari) submodule of our Vivari fork,
pinned to `facilis/main` (upstream `v1.2.0` + the fixes we carry; D-030): it is never edited
in the worktree, only bumped to a fork commit ([`vendor/README.md`](../vendor/README.md),
branch map in the fork's `FORK.md`).

**Branding (D-069, D-075).** The product presents itself as **facilis.dev** and points at
<https://facilis.dev>; the visible title in the title bar is the logo lockup (black and white,
see [`brand/`](../brand)), not a text string. The Vivari name stays only in the provenance and
attribution above, in the kernel's real package ids (`@vivari/core`, `vendor/vivari/**`) and in
the `__vv*` internals. Brand strings are catalogue entries (`app.name`), not JSX literals; the
preview Service Worker is the one synced file whose copy diverges (noted at the top of
`ide/public/sw.js`).

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
- **Themes.** A theme is a complete `[data-theme="…"]` block of role values in
  `index.css`; components only name roles (`bg-chrome`, `bg-editor`, `bg-panel`,
  `bg-brand`, `text-muted-foreground`, `bg-warning`, …). Raw palette colours are only for
  brand marks and scrims, with a comment. next-themes writes the attribute, the user picks
  Light / Dark / System in the command palette, and `ui-themes.ts` maps a theme to the
  appearance Monaco/xterm follow. Adding a theme = one CSS block + one registry entry (D-044).
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

**300-line ratchet:** twelve files inherited from upstream are above the limit
(`controller.ts` 2.5k and falling, ten components, `vite.config.ts`). They are recorded in [`scripts/file-length-baseline.json`](../scripts/file-length-baseline.json)
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
4. Four deep imports in `src/vv/` (`project-import.ts`, `project-export.ts`,
   `python-language.ts`, `editor-python.ts`) point at
   `../../../vendor/vivari/packages/{kernel-host,runtime}`.
5. Formatting: the tree is formatted with the repo Prettier config (mechanical, no behaviour
   change). Keep it formatted; do not re-run upstream's formatter.
6. Twelve files above 300 lines, recorded in the file-length baseline (see above).
7. **The upstream template catalog is gone** (D-051): `src/vv/templates.ts`,
   `src/vv/templates-lazy.ts`, `templateIcons.tsx` and the brand SVGs they bundled are
   deleted. The IDE creates Facilis projects only, through
   `src/vv/project-manifest.ts`, `src/facilis/template-loader.ts` and one Home dialog.
8. `public/sw.js`: carries the **per-kernel preview routing** (D-033), now upstream's own
   (upstream #23 + its follow-up, released in v1.1.5): a same-origin preview URL carries the
   kernel's per-boot token, the SW records the frame against that tab and redirects the token
   away, and the routing maps are pruned. The IDE serves its own copy of the upstream Service
   Worker, so a change there is made in `vendor/vivari/packages/studio/public/sw.js` first and
   mirrored here — keep the two in sync (the IDE copy is mirrored through the repo's Prettier,
   with `catch {}` and a `Set` for the isolation policies to satisfy our lint).
9. **AI chat** (D-045…D-048): `src/ai/` is the Facilis AI layer — provider presets and a
   streaming client for the OpenAI-compatible and Anthropic protocols, Model A prompt assembly,
   the `AIResponse` parser, the diff used by the review card, and `ChatSession` behind a small
   `ChatHost` (one per controller, in `chat-host.ts`). `src/components/ide/ChatPanel.tsx` plus
   `ChatMessageView` / `ChatProposalView` / `ChatSettingsDialog` render it under the new
   `chat` activity view; the command palette gains "Open AI Chat". The message field streams
   into the bubble as the provider writes it (the JSON contract is unchanged), the review card
   warns about Node globals and server-only imports in client files, and a clean Apply can be
   undone from its before-images (D-047). A project can steer the assistant through a root
   `AGENTS.md` (opened/created from the chat header; preferences only, never an override of the
   rules or the response contract, D-048). The model never writes: Apply sends only the accepted
   patches through `src/facilis/apply-patch.ts`. The key is BYO, stored per origin in
   `localStorage` and sent only to the chosen provider; the dev-only `mock` provider exists
   only in `vite dev` and lets `pnpm ide:smoke` exercise the whole flow.
10. **Multi-tab** (D-033): Home's recent-project row moves to
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
Measured on 16 cores with the old template pair (one React, one Vue — the smoke now creates
two Facilis projects): two tabs cost ~355 MB + ~362 MB of
worker memory and the second tab boots **+2.5-2.9 s** (it restores the shared tree); both dev
servers bind 5173 in their own VM, which is why the preview Service Worker routes per preview
frame rather than per port. `pnpm ide:smoke:multitab` is the acceptance run (~4 min).

**Vite version:** the upstream catalog's Vite 7 pin went with it (D-051). The one remaining
template is `src/facilis/project-files.ts`, which pins the Vite version its own `pnpm ide:smoke`
proves in the VM. Environment notes and the rest of the in-VM constraints:
[`docs/DEV.md`](../docs/DEV.md).

## Where Facilis code goes

New Facilis panels and the `IdeController.applyPatch()` write path belong in new modules under
`ide/src/` (writes go through `kernel.writeFiles`, never OPFS directly — SPEC §10.3). Upstream
files are formatted/linted but not otherwise rewritten; forced edits go into the patch set above.

The AI chat lives in `ide/src/ai/` (D-045/D-046): pure modules with vitest files, plus a
`ChatSession` that talks to the editor only through `ChatHost` and to the model only through an
injected call — so the UI and the write path stay testable without a browser or a key. Everything
it writes goes through the same validated `applyPatch` path.

The Facilis module is `ide/src/facilis/`: the template that boots a real Facilis app in the
WebContainer (`facilis()` mounts Nitro + PGlite + `/__facilis/*`) and the only project the
IDE creates (D-051). The generated project **is the reference app `examples/todo-app`**
(D-062): `example-template.ts` inlines its client, server, schema, locales and configs at IDE
build time through `import.meta.glob(?raw)`, so the two cannot drift; `project-files.ts`
writes only what the IDE must own (the npm wrapper with vendored `@facilis/*` tarballs, a
standalone `tsconfig.json`, the npm hooks), and `template-overrides.ts` adds only the IDE's
own bits: the liveness `ping` route the write smoke edits, the HMR hint plus its footer
style, and the in-process Nitro runner. The framework probe is **not** in the project — 
`scripts/dev/smoke-facilis.mjs` drives the endpoints from the IDE page, so a user's starter
carries no test instrumentation. `template-loader.ts` keeps the payload lazy.

The generated project has **one config**, `facilis.config.ts`: its `nitro` section carries
the WebContainer constraint `devServer: { runner: "self" }` (Nitro's default node-worker
runner needs `worker_threads` and a file-URL `import.meta.resolve`, which the VM does not
provide), there is no `nitro.config.ts`, and `vite.config.ts` never imports Nitro (D-034).
The probe also drives a full database roundtrip — register, log in, `POST /api/todos`, read
the list back — and reports it to the smoke as `facilisDbInsert`/`facilisDbQuery`: PGlite,
the migrations and the authorized-handler stack only prove themselves inside the VM, not in
Node. Its `package.json` pins `@types/react`/`@types/react-dom` 19.3.0 because Monaco's
TypeScript service only sees installed `@types/*.d.ts` — without them the editor reports
TS2307 on `react`. The generated project installs with **npm**
(D-032): the `@facilis/*` tarballs are inlined into the create request (the manifest's
`assets`, fetched same-origin by the IDE) and land in the project's `./vendor`, declared as
`file:` dependencies,
so no install reaches the studio over HTTP and the project stays installable outside the IDE.
The npm version is pinned in lockstep with the VM's Node — `NPM_VERSION` in
`scripts/dev/vendor-assets.sh` must equal the template's `packageManager`, and
`ide/src/facilis/package-manager.test.ts` enforces it. The constraints and the upstream bugs
behind them are recorded in `docs/DECISIONS.md` D-022…D-024, D-032, D-034 and summarized in
`docs/DEV.md` §6.
