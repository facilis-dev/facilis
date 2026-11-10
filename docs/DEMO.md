# The three-minute demo

The MVP target (SPEC §1.4/§12 Phase 6): **chat → working, secure, authenticated todo app** in
under three minutes, from a fresh browser session. This page is the script. It is the human
counterpart of `pnpm ide:smoke`; the smoke run is what proves it in CI (see §Automated proof).

## One-time setup

The IDE runs the vendored kernel, so the four build artifacts must exist first (full recipe and
troubleshooting in [DEV.md](./DEV.md)):

```bash
git submodule update --init vendor/vivari
pnpm install
pnpm ide:wasm
pnpm ide:assets
pnpm ide:facilis-deps
pnpm ide:browser          # only needed for the headless smoke run
pnpm ide:dev              # http://localhost:5173
```

Start from a **fresh browser profile** (or a private window with no stored site data) so the
timings below are honest.

## The script

| Clock | Action | Checkpoint |
|---|---|---|
| 0:00 | Open the Studio. | Home lists no project; the kernel boots behind the splash. |
| 0:05 | **New project** → keep the pre-filled folder name → **Create**. | The project is scaffolded from `examples/todo-app` (D-062) and opens in the editor. |
| 0:20 | Press **Run**. | The install runs from the IDE-served tarballs (D-032); the preview paints the todo login page. |
| 0:40 | Register the `FACILIS_INITIAL_ADMIN` email **and the bootstrap token** in the preview (D-150). | The todo app is authenticated: create/complete a todo works. |
| 0:55 | Open the **Data** view (database icon). | Tables with columns, RLS badges on the scoped tables, reverse route usage, and *"Code and database are in sync"*. |
| 1:10 | Open **AI Chat** → settings → provider **Mock (dev)** → send any prompt. | The answer streams, then a **reviewable proposal** appears: one per-file diff, validator clean, Apply enabled. |
| 1:30 | **Apply**. | The file is written through `applyPatch()` only, Undo becomes available, and the new file appears in the Explorer. |
| 1:45 | (Optional, with a real key) ask *"add a due date to the todo form"*, review the diff, Apply. | Same proposal/validate/apply flow against a real model; the preview hot-updates after the write (HMR). |
| 2:10 | In the preview's address bar append `/_openapi.json`. | Every route carries `x-db-tables`/`x-permission`; the API contract is the spec. |
| 2:30 | **Source Control** → stage the chat change → commit. | A normal commit on the VFS; pushing needs a token and the same-origin proxy (D-079, optional for the demo). |
| 2:50 | Done. | Under three minutes, no backend, no account on the Studio. |

## What the script must not skip

- The **validator** runs before the proposal exists, again on Apply and once more inside
  `applyPatch()` (D-084). If the proposal card shows a blocking error, the demo stops there —
  nothing was written.
- The **entity explorer** compares `db/schema.ts` with the live catalog (D-083): after a schema
  patch the Data view shows the drift disappear once the migration runs.
- The **Studio is static**: the only network calls are the git host (only when pushing) and the
  AI provider the user configured (D-066).

## Automated proof

`pnpm ide:smoke` drives the same flow headlessly on a real Chromium: boot → create the Facilis
project → install → preview paints → manifest with zero warnings → `x-db-tables` → 401 on an
unauthenticated route → the editor's TypeScript service resolves the template imports. The
framework endpoints are checked by `scripts/dev/smoke-facilis.mjs`; the multi-tab rules by
`pnpm ide:smoke:multitab`.

## Notes

- The **Mock (dev)** provider is built into dev builds and never calls a network: it returns a
  fixed, safe patch so the proposal/validate/apply path can be demonstrated without a key
  (D-045).
- A **managed** build (D-063) turns AI and imports off by policy; run the demo against the
  `open` profile.
- If the preview or the Data view says *unreachable*, the project is still booting: the panels
  are throw-free by design and recover on the next revision poll.
