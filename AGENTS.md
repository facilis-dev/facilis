# AGENTS.md

Guidance for AI agents (and humans) working on **Facilis**. Read this first, then read
[`docs/SPEC.md`](./docs/SPEC.md) — it is the contract. If this file and the spec disagree,
the spec wins; if the spec is silent or ambiguous, record a decision in
[`docs/DECISIONS.md`](./docs/DECISIONS.md) instead of guessing.

---

## What this project is

Facilis is a browser-resident framework: a static Studio SPA (fork of Vivari) runs a
generated project inside a WebContainer, where **`vite dev`** is the single dev server and
**Nitro v3 runs as a Vite plugin**. Security, schema safety, and API contracts are
structural (compiler/framework), not optional lint rules.

Repository layout (see spec §4):

```
packages/    @facilis.dev/core, db, auth, ai, nitro, analyze (AST facts, D-092)
ide/         Facilis IDE app (MIT fork of Vivari Studio)    [Phase 0+]
vendor/vivari/  Vivari via our fork (git SUBMODULE, MIT), pinned to `facilis/main`
             [never edited here, never shipped, not in the pnpm workspace; see D-030]
starter/     template cloned by users                        [Phase 1+]
examples/    example generated apps
spikes/      throwaway feasibility spikes (never shipped; absent when none is active)
scripts/     repo gates (file-length ratchet) + scripts/dev/ (IDE build & smoke, see docs/DEV.md)
docs/        SPEC.md (contract) + DECISIONS.md (ADR log) + DEV.md (environment recipe)
brand/       logo + identity assets (black & white), see brand/README.md
```

---

## Toolchain (locked)

| Concern | Choice |
|---|---|
| Runtime | **Node >= 22.15.0** (`.nvmrc` = 22) |
| Package manager | **pnpm** workspace (v12) + **turbo** |
| Package registry | **public npm, scope `@facilis.dev`** (D-164) |
| Language | **TypeScript, strict**, ESM only (`"type": "module"`) |
| Lint / format | **oxlint** + **Prettier** (root configs) |
| Tests | **Vitest** |
| UI | **React 19 + Tailwind CSS v4 + shadcn/ui (Base UI primitives)** |
| Backend / DB | **Nitro v3** (Vite plugin) + **Drizzle** + **PGlite** |
| Validation | **Zod** |

Pin Nitro to an exact version — v3 is beta (spec §13 risk 2).

---

## Code conventions

- **Hard limit: 300 lines per production source file.** Enforced by
  `scripts/check-file-length.mjs`; fix by splitting, never by adding an exclusion. **Test
  modules are exempt** (`*.test.ts`, `*.test.tsx`, `*.spec.*`): a long scenario suite or
  fixture is expected, and splitting it just to satisfy the gate is wasted effort — the limit's
  purpose is production source. The only other exception is the upstream-derived IDE import:
  those files are pinned in `scripts/file-length-baseline.json` and the check is a **ratchet**
  (may shrink, may not grow, entries disappear as files are split, no new entries).
- **Named exports only.** Default exports are allowed only where a tool requires them
  (`vite.config.ts`, `nitro.config.ts`, route modules if Nitro forces it).
- **File names kebab-case** (`define-authorized-handler.ts`); **React components
  PascalCase** (`DataTable.tsx`); types/interfaces PascalCase; constants UPPER_SNAKE only
  for true module-level constants.
- **Nitro file router naming is mandatory**: `index.get.ts`, `[id].patch.ts`,
  `manifest.get.ts` (spec §4.2).
- Imports between packages use the package name (`@facilis.dev/db`), never `../../packages/...`.
- **Relative imports inside `packages/*/src` carry the `.ts` extension** (`from "./config.ts"`).
  Packages ship their `src` and a Vite config is loaded by Node's native ESM loader, which
  requires explicit extensions; `tsc` rewrites them to `.js` on emit
  (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`).
- No `any` (use `unknown` + narrowing). No non-null assertions without a one-line `why`.
- Comments explain **why**, not what. No commented-out code, no dead code.
- API responses are **codes, not prose**; every user-facing string goes through
  `t("key")` with keys registered in `locales/en.json`.
- Keep generated artifacts (`dist/`, `.turbo/`, coverage, `node_modules/`) out of git.

---

## Security invariants (non-negotiable, spec §8)

1. Every API route is written with `defineAuthorizedHandler` — no exceptions.
2. `dbTables` is an applied declaration, always present (empty array allowed) and accurate: every
   table **and view** a route touches through `ctx.db`/`ctx.sudo`/`ctx.system`, and every relation
   a job's `run` touches through its system-scoped `db`, is declared; checked statically
   (analyzer, CI gates, AI rules 18/19) and enforced at runtime (D-157/D-162); `db.execute` only
   with `rawSql: true`. A workflow declares nothing: its surface is derived from the
   `dbTables` of the jobs its steps reference (D-162).
3. Input is validated with Zod; invalid input → `400`.
4. Every table is exactly one of two classes (D-136): RLS-scoped (`ENABLE ROW LEVEL SECURITY` +
   its `pgPolicy` set, which is what grants `facilis_app` access) or system-only (no RLS → no
   app-role privilege; reachable only through the audited system identity). App-level scoping uses
   `drizzle-policy`.
5. No raw Drizzle client imports outside `@facilis.dev/db`.
6. Dev-only endpoints are `404` in production and origin-allowlisted.
7. Studio writes go through `kernel.writeFiles` (Vivari VFS); never touch OPFS directly.
8. Roles/permissions are declared in `facilis.config.ts`; `role_permissions` is written
   only by migrations.
9. AI patches pass the 19-rule validator before touching disk.

If a change cannot satisfy an invariant, stop and raise it — do not weaken the invariant.

---

## Definition of done

A change is done when all of the following are true:

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass.
- New route: auth + `dbTables` + Zod input + i18n keys + OpenAPI metadata.
- New table: Drizzle schema + RLS policy + generated migration.
- New user-facing string: `t()` key registered in `locales/en.json`.
- Docs updated when a contract changes (spec and/or `docs/DECISIONS.md`).
- No new file exceeds 300 lines.

## Working style — match effort to risk

- Size the verification to the change. Behaviour, contract or cross-package changes get the
  full Definition of done above. A one-line script, config, copy or comment edit needs the
  edit and a one-line report — running the whole gate set, or building a bespoke experiment,
  is wasted time there. Do whatever single check would actually catch a breaking mistake, if
  any; otherwise just do it.
- No overthinking on minimal changes: no speculative refactors, no new harnesses, no
  re-investigating the environment for a flag change. If something unrelated looks off,
  mention it in one line and move on.

---

## Git

- **Conventional Commits**: `feat|fix|chore|docs|test|refactor(scope): summary`.
- Work on a branch; `main` is the integration branch.
- **`main` is protected (policy from 2026-11-12): every change reaches it through a pull
  request with at least one approving review — no direct push and no direct merge to
  `main`.** The PR description carries the Definition-of-done evidence (`pnpm lint`,
  `pnpm typecheck`, `pnpm test`, `pnpm build`, plus any browser gate the change needs).
  The repository's GitHub branch protection for `main` must keep this enforced.
- Never commit secrets, `.env`, private keys, or generated runtime manifests
  (`/__facilis/manifest` is never committed).
- Keep commits small and reviewable; do not mix refactors with behaviour changes.

---

## Testing

- Unit/integration tests with **Vitest**, colocated as `*.test.ts`.
- Feasibility spikes live in `spikes/<name>/` — standalone, not part of the workspace,
  never imported by packages, never shipped. The directory exists only while a spike is
  active: the Phase 0 one was retired once its findings landed in code and spec (D-006).
- Prefer proving a risky assumption with a runnable spike over a design argument
  (spec §12 Phase 0, §14.1 acceptance criteria).

---

## IDE-specific notes

`ide/` is a fork of [Vivari Studio](https://github.com/maitrungduc1410/vivari) (MIT) that
starts from upstream `packages/studio` at the pinned tag, then follows **this repository's**
rules: workspace member, strict TypeScript, the root oxlint/Prettier config, vitest, and the
300-line limit (via the baseline ratchet for the inherited files). Keep the UI stack
(Tailwind v4 + shadcn/Base UI, React 19, Monaco/xterm) and isolate Facilis changes in new
modules (`ChatPanel`, `ProjectGraphPanel`, `DataExplorerPanel`, `ReleasePreviewPanel`) rather than
rewriting upstream files. The kernel it runs on is the `vendor/vivari` submodule of our
Vivari fork, pinned to `facilis/main` (read-only; bump the commit — never edit the worktree —
see D-030 and `vendor/README.md`). See spec §10 and `ide/README.md` for the exact patch set.

**UI rules (D-043).** Every user-facing string goes through `t()` from `ide/src/i18n`, with
the key in `ide/src/i18n/en.ts` (and `it.ts` where translated) — never inline JSX text or a
toast literal, including in the controller's status messages. Every surface uses the semantic
Tailwind role tokens so a theme block flips it (themes are complete variable sets, D-044); raw
palette colours only for brand marks/scrims with a reason. The tracking checklist is `ide/I18N.md`; new UI ships compliant from its first
commit, and upstream-inherited files are migrated as they are touched.

**Building and verifying it** is scripted, because the kernel's Wasm packages and its runtime
assets are gitignored upstream artifacts and a browser is needed to boot it: `pnpm ide:wasm`,
`pnpm ide:assets`, `pnpm ide:browser`, then `pnpm ide:dev` / `pnpm ide:smoke`. The full
recipe, pinned tool versions, in-VM constraints and troubleshooting live in
[`docs/DEV.md`](./docs/DEV.md). Do not add ad-hoc setup steps — extend those scripts.
The Vite templates inside the IDE resolve `vite@^7.1.0` on purpose: Vite 8's rolldown cannot
load its wasm binding in the WebContainer (see `ide/README.md`), so do not bump it without a
green `pnpm ide:smoke`.
A generated project installs with **npm**, the package manager the IDE vendors (D-032), pinned in
lockstep with the VM's Node: `NPM_VERSION` in `scripts/dev/vendor-assets.sh` must equal the
template's `packageManager` (`ide/src/facilis/package-manager.test.ts` fails if they drift;
`pnpm` survives only as rolldown's in-VM fallback). The framework packages are ordinary
**registry dependencies**, installed from npm at the exact version the IDE build pins through
`FACILIS_PACKAGES_VERSION` (D-166); nothing is vendored into the project or inlined as a tarball.
Several projects run at once as **browser tabs** (D-033): one project per tab, one kernel per
tab, and the same project refused in a second tab (Web Lock, `ide/src/vv/project-lock.ts`). A
tab opened from another one carries `?project=<rootPath>`; `ide/src/vv/project-tabs.ts` boots it
and keeps the claim. Per-origin state must be **merged, never rewritten whole**: the preview
Service Worker routes per **preview frame**, by the per-boot **kernel token** a same-origin
preview URL carries (upstream #23 + its follow-up, released in v1.1.5), so `ide/public/sw.js`
must stay in sync with `vendor/vivari/packages/studio/public/sw.js` except for the IDE-side
persisted preview-routing patch (D-132, issue #4), which has to be re-applied on every sync; the OPFS
VFS index is merged per tab under a Web Lock (upstream #22 + follow-up); and Home's
recent-projects registry is a read-merge-write in `ide/src/vv/project-registry.ts`, because a tab
writing its stale list dropped another tab's project from Home. Acceptance:
`pnpm ide:smoke:multitab`.
The OPFS mirror's boot restore is **scoped** (D-036): Home's known roots go to the kernel as
`BootOptions.deferRestoreRoots`, so a tab replays only the project it opens
(`vv-restore-roots`, `IdeController.openProject`) instead of every project on the origin. The
deferred paths stay in the shared index and are merged by whichever tab writes them, so opening
a project re-materializes exactly its subtree and nothing else.
**The package-manager cache follows the same rule per file** (D-037): `deferCacheFiles` leaves
cache bodies on OPFS and the FS worker replays one on the first syscall that observes its bytes
(`installDeferredHydration` in `vendor/vivari/packages/core/src/workers/fs-worker.ts`). That
gate is the single place the rules live — if a syscall or opcode that reads file bytes is added,
it must be classified there (replay / no replay for truncating writes / drop for deletes /
answer from the index for probes), or the cache will be read as empty or truncated.
