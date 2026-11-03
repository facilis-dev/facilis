# IDE findings — building facilis.dev inside the Studio

**Status:** open · started 2026-11-03 · owner: IDE
**Source:** building the facilis.dev site (D-091) with the real Studio, driven by the development
harness in `spikes/ide-audit/`. These are problems met while actually using the IDE, not a
synthetic audit. Each entry has the evidence, the repro and a suggested fix. Nothing here is fixed
yet.

Severity is about the user, not the code: **high** = the user cannot tell what happened or can
lose work; **medium** = noisy, confusing or slow; **low** = polish or tooling.

| ID | Sev | What | Status |
|---|---|---|---|
| F-001 | high | A two-file change (new page + route table) leaves the preview stuck on the old app, showing only the debug hint, with no error anywhere | verified, cause open |
| F-002 | high | The editor keeps a stale buffer when a file changes underneath; saving it would overwrite the change | verified |
| F-003 | medium | The generated app ships the HMR hint as visible UI content, and re-generation re-adds it | verified |
| F-004 | medium | A React console error (`Encountered a script tag while rendering React component`) fires while the preview renders | verified, cause open |
| F-005 | medium | A dev checkout silently installs every project from scratch: the vendor depcache/locks are not assembled and only the terminal says so | verified |
| F-006 | low | Create → preview takes ~130 s with a blank pane and no phase indicator | verified |
| F-007 | low | Home action cards carry the whole card copy as their accessible name, so tooling cannot target "New project" | verified |
| F-008 | ? | Explorer may not list a file created outside the UI | unverified |

## F-001 — preview stuck after a new module + importer

**Repro** (`spikes/ide-audit/develop.mjs`): create a project, wait for the preview (the template
renders its login card), then write `src/pages/home.tsx` and a new `src/app.tsx` that imports it,
both through the kernel VFS. The terminal reports `[vite] hmr update /src/app.tsx, /src/styles.css`;
the preview does **not** show the new page — it shows only the old app's debug hint, and no error
overlay appears. The same harness with a **single-file** change (`spikes/ide-audit/diagnose.mjs`,
no new import) shows the new page within 4 s, so the write path and HMR are fine on their own: the
failure needs a module that the importer introduces in the same step.

**Evidence:** `docs/findings/f1-preview-template.png` (before: login card),
`f1-preview-after-write.png` (after: hint only), `f1-diagnose-applied.png` (control: single-file
change applied).

**Why it matters:** this is the normal authoring move — add a page, wire the route. When it
silently keeps the old UI, the user redeploys or rewrites code that is already right.

**Suggested direction:** on a failed hot update, fall back to a full reload of the preview frame
(Vite knows; the client can send `{type:"full-reload"}`), and surface the failure in the IDE (a
status line or a "reload preview" affordance) instead of leaving a half-rendered tree.

## F-002 — stale editor buffer after an external write

**Repro:** with `src/app.tsx` open in a tab, write the same file through the VFS (the path the AI
patch and automation use). The terminal HMR line proves the file changed; the tab still shows the
old source with no dirty/changed marker. Saving the tab writes the old content back.

**Evidence:** the editor pane in `docs/findings/f1-preview-after-write.png`.

**Suggested direction:** the editor should receive the same "file changed on disk" event the
preview gets (reload if clean, conflict prompt if dirty). VS Code has the same contract.

## F-003 — the HMR hint is shipped UI

The template appends `<p className="muted">Edit src/app.tsx and save to test HMR.</p>` to every
generated app; it is visible in the preview and in the production build, and the IDE's
`template-overrides.ts` re-adds it, so deleting it by hand is undone by the next re-generation.
The smoke test relies on that exact string as its anchor.

**Suggested direction:** keep the string for the smoke by injecting it only in dev
(`import.meta.env.DEV`) or by having the smoke write it; do not ship it in the app.

## F-004 — console error while rendering the preview

**Repro:** open a project preview and read the Studio console: `Encountered a script tag while
rendering React component…`. It appears in both the template and after edits, in a project that
contains no `<script>` in its components.

## F-005 — a dev checkout installs cold

**Repro:** `pnpm ide:dev` in a checkout where `pnpm ide:assets` has not assembled the vendor
snapshots. The kernel terminal prints:

```
[locks] vendor/locks/index.json could not be read … Fix: `npm run vendor:locks`.
[depcache] vendor/depcache/index.json could not be read … Fix: `npm run vendor:depcache`.
[depcache] no snapshot for npm — installing…
```

and the first project pays the full ~130 s install. The deployed build runs those scripts, so this
hits developers and automation, not users.

**Suggested direction:** `ide:dev` should warn in the app (a boot banner) or the scripts should
run as part of it; a silent 130 s tax on every fresh checkout is how regressions get missed.

## F-006 — no progress during create → preview

132 s from Create to the first paint (measured twice: 129.5 s, 132.3 s), with the preview pane
empty and progress only in the terminal. The status bar does say a project is installing, but the
pane the user is looking at is blank.

## F-007 — Home cards and their accessible names

The "New project" card's text includes its description, so an element matched by the accessible
name is not "New project". Human users are fine; any automation (ours included) has to match a
substring, and a screen reader announces the whole card copy as the button name.

## F-008 — explorer refresh (unverified)

After writing `src/pages/home.tsx` through the VFS, the harness did not find the name in the DOM,
but the `pages` folder was collapsed in the run, so this proves nothing either way. Worth a check
next time the harness is extended: does the explorer list a file created outside the UI?
