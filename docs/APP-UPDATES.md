# App updates

**Status:** accepted and partially implemented (2026-11-01): the project marker, the local
version comparison, the status-bar indicator and the upgrade engine (plan + apply with
rollback) landed. Still pending: the upgrade action in the UI (controller facade and
postflight), data migrations, and the first shipped recipe.
Decision: D-065. Related: [MANAGED-DEPLOYMENT.md](./MANAGED-DEPLOYMENT.md), SPEC §8 and
§10.5, D-032, D-036, D-037, D-042, D-052.

The IDE runs projects that outlive the build that created them. Two different things can be
"out of date":

| Layer | What moves | How it reaches the user |
|---|---|---|
| **Environment** | the Studio build, `@facilis/*`, the template, npm/Node, the kernel pin | a redeploy, then a page reload - invisible |
| **Project** | the generated app: framework packages, scaffold, dependencies, DB migrations | the IDE tells the user, and the user applies it - this document |

The environment layer is the deployment's problem ([MANAGED-DEPLOYMENT.md](./MANAGED-DEPLOYMENT.md)
§4). This document is the project layer: an indicator in the IDE, and a guided, reversible
upgrade.

## 1. The project marker

Every generated project carries `facilis.app.json`, written by the template loader at
creation and updated only by an upgrade:

```json
{
  "schemaVersion": 1,
  "template": "facilis",
  "templateVersion": "2026.11",
  "environmentVersion": "2026.11",
  "lockfileHash": "sha256-...",
  "createdAt": "2026-11-01T10:00:00Z"
}
```

- `environmentVersion` is the IDE build that created (or last upgraded) the project; it is
  what the indicator compares against.
- `templateVersion` allows a scaffold-only update (new base files, new example features)
  independent of the framework packages.
- `lockfileHash` makes a hand-edited `package.json`/lock drift visible instead of silently
  "up to date".
- The marker is not `package.json`: it is Facilis metadata, it must survive dependency edits,
  and it must not be something the user has to understand.

Projects created before this exists have no marker: the IDE treats them as "unknown
environment" and offers a one-time adoption step that only writes the marker for the current
version (no file changes).

## 2. What "up to date" means

The running build knows its own environment version (a constant compiled into the bundle;
`environment.json` mirrors it for the operator), so the check needs no network:

- project version == current version: up to date;
- project version < current: updates available;
- project version > current: the project was made by a newer build (multi-tab, restored OPFS);
  do not downgrade, show "open it with a newer Studio" instead.

In `managed` the comparison is against the **approved baseline** in the deployment config,
not the newest thing Facilis ever shipped: the update list only offers versions the company has
approved, and a dependency outside the allowlist is reported as *action required*, not as an
update.

## 3. What the user sees

- a badge/dot in the status bar or Home (one number: how many items);
- a panel grouping the work:
  1. framework packages (`@facilis/*`, the runtime);
  2. scaffold/template files (new example features, fixed defaults);
  3. dependencies (upgradeable versions inside the policy);
  4. data/schema migrations, when the update touches the DB;
  5. skills (approved versions, for the skills the project uses);
- per item: "Aggiorna", "Dettagli"; for the whole set: "Aggiorna tutto";
- `managed` additionally: "Ignora" (pin the project; the item stays visible and the
  deployment can report on it), and blocked items that cannot be ignored;
- every string goes through `t()` with keys in `ide/src/i18n/en.ts` (D-043).

## 4. Upgrade engine

Recipes ship with the IDE build (needed for air-gapped deployments too):

- one recipe per `from -> to` step, ordered, idempotent, with a human-readable description;
- recipes are code: reviewed, tested and versioned with the build that contains them;
- the engine applies them to the VFS through the controller, never to OPFS directly
  (SPEC §8 invariant 7);
- preflight: the project must be clean (git) or a snapshot is taken; the tab must hold the
  project lock (D-033);
- postflight: regenerate the dependency tree (`npm install` against the configured registry),
  run `tsc --noEmit`, then the DB migration if any;
- failure: restore the snapshot/branch, report the step that failed, leave the marker
  unchanged; the project is never left half-upgraded;
- success: rewrite `facilis.app.json`, commit on a branch (the project is already a repo),
  and report a one-line summary.

The recipe list is bounded by the versions in the build: an environment does not need recipes
for versions it never was, and an air-gapped deployment does not fetch them.

### The engine as shipped

`ide/src/facilis/upgrade/` turns the recipe table into explicit file operations and then
performs them:

- `recipe.ts` - the contract. A step declares the files it wants in their final state
  (`files(read)`, `null` = delete), never performs I/O itself; its title is an i18n key, and
  `assertRecipePath` refuses absolute paths, backslashes and `..`. Declarative recipes are
  what make a dry run, a rollback and a reviewable diff possible.
- `plan.ts` - the dry run. It selects recipes with the version comparison, runs their
  `files(read)` over an overlay (a later step sees what an earlier one wrote), collapses
  several edits to one file into its final content, drops files already in the target state,
  sorts the operations, and returns the `before`/`after` of every path. A build whose table
  is ambiguous (two recipes for one target, a step that does not move forward) fails the
  plan instead of guessing. A current, unknown or ahead project reads nothing.
- `apply.ts` - the write. It first re-checks the plan against the VFS (a plan is made from a
  read; another tab, an AI patch or the user may have written since - a mismatch refuses
  instead of overwriting), writes or deletes the files, runs the caller's **postflight**
  (install, `tsc --noEmit`, DB migration), and only then rewrites `facilis.app.json`. Any
  failure restores every path already touched, in reverse, and leaves the marker on the old
  version, so a retry starts where it was; `UpgradeError.rolledBack` says whether the
  rollback itself completed. The VFS sits behind an injected `UpgradeIo`, keeping the
  controller facade the only writer (D-042).

The table still ships empty. Adding a recipe is appending `{ from, to, titleKey, files }`
to `update-recipes.ts`, adding its `titleKey` to `ide/src/i18n/en.ts` (and `it.ts`) and
covering it in `upgrade/plan.test.ts`.

**Not wired yet:** the panel is a dry run - it lists the steps the build ships and the files
they would change, but there is no "Aggiorna" button. The action needs the controller facade
(install through the run phase, `tsc --noEmit`, the DB migration in §5) and the project lock
(D-033); until it exists an outdated project keeps saying what this build can do.

## 5. Data migrations

Two data stores can be affected, and both need care:

- **app DB** - Drizzle migrations already exist; an upgrade runs the generated one, with a
  pre-upgrade backup of the PGlite snapshot (D-052);
- **browser state** - the project lives in OPFS (D-036/D-037). A recipe that changes the
  project layout must take the snapshot first, then write; it must not rely on the
  write-behind mirror.
- `schemaVersion` in the marker is the compatibility key: a build refuses to open a project
  whose schema is newer than it understands.

## 6. Managed mode specifics

- update channel `approved`: the baseline is compiled in (mirrored in `environment.json`);
  upgrades may only land
  on versions the company's mirror serves and the config allows;
- if the config removes a package the project uses, the panel shows it as *blocked*, with the
  offending file(s), and the only action is to bring the project back in policy;
- the environment itself is never self-updated by the IDE: the operator redeploys;
- skills follow the same baseline: only approved versions are offered, and a skill outside the
  allowlist is reported as blocked.

## 7. Non-goals

- no auto-update, no forced update, no server-driven feed;
- no downgrade;
- no cross-deployment migration of OPFS state (moving a project to another company origin is an
  export/import, not an update).

## 8. Edge cases

| Case | Behaviour |
|---|---|
| no marker (pre-existing project) | one-time adoption, no file changes |
| marker newer than the build | refuse downgrade, explain |
| dirty git tree | snapshot instead of a branch, or ask |
| a second tab on the same project | the project lock decides; the other tab is read-only for updates |
| offline / air-gapped | recipes ship in the build; no network needed |
| partially failed upgrade | rollback, marker unchanged |
| imported project (`admission: "any"`) | no marker, so no updates offered |

## 9. Implementation map

New modules in `ide/src/facilis/`:

- `app-manifest.ts` - read, validate and write `facilis.app.json`;
- `updates.ts` - version parsing/comparison and which recipe steps apply;
- `upgrade/recipe.ts` - the recipe contract (declarative files, i18n title, path guard);
- `upgrade/plan.ts` - the recipes turned into explicit before/after file operations;
- `upgrade/apply.ts` - re-check, apply, postflight, verify, rollback (D-070);
- `update-recipes.ts` - the table this build ships (empty today);
- `app-status.ts` - marker read plus the plan against the build version;
- UI: `ProjectUpdateBadge` in the status bar (dry run), strings in `ide/src/i18n/en.ts`.

Tests: recipe application on fixtures, rollback on an injected failure, the version-comparison
table, marker round-trip, the managed baseline and blocked cases. The engine's own tests sit
next to it: `upgrade/plan.test.ts` (overlay, dedupe, no-op, path escape, ambiguous table) and
`upgrade/apply.test.ts` (marker written last, stale plan, rollback on a write and on a
postflight failure, deletion of a file created earlier in the same run).

## 10. Open questions

- Where recipes live in the IDE tree, and how they are tested against `examples/todo-app`.
- Whether the marker should record the *template* hash (scaffold drift) in addition to the
  version.
- Snapshot granularity for the DB: full PGlite snapshot versus per-migration backup.
- Whether "Ignora" is meaningful in `open` (probably not), and for how long it survives.
