# The three-minute demo

The MVP target (SPEC §1.4/§12 Phase 6): **chat → working, secure, authenticated todo app** in
under three minutes, from a fresh browser session. This page is the script. It is the human
counterpart of `pnpm ide:smoke`; the smoke run is what proves it in CI (see §Automated proof).

## One-time setup

The IDE runs the vendored kernel, so the three build artifacts must exist first (full recipe and
troubleshooting in [DEV.md](./DEV.md)):

```bash
git submodule update --init vendor/vivari
pnpm install
pnpm ide:wasm
pnpm ide:assets
pnpm ide:browser          # only needed for the headless smoke run
pnpm ide:dev              # http://localhost:5173
```

A release build pins the `@facilis.dev/*` dependencies to the versions committed in
`packages/*/package.json` and installs them from npm (D-166, D-198). A dev build
(`pnpm ide:dev`) instead vendores the workspace packages locally by default (D-196), so the
demo exercises the checkout's code; `FACILIS_IDE_LOCAL_PACKAGES=0` opts back into npm.

Start from a **fresh browser profile** (or a private window with no stored site data) so the
timings below are honest.

## The script

| Clock | Action | Checkpoint |
|---|---|---|
| 0:00 | Open the Studio. | Home lists no project; the kernel boots behind the splash. |
| 0:05 | **New project** → keep the pre-filled folder name → **Create**. | The project is scaffolded from `examples/todo-app` (D-062) and opens in the editor. |
| 0:20 | Press **Run**. | The install resolves `@facilis.dev/*` from npm at the pinned version (D-166); the preview paints the todo login page. |
| 0:40 | Register the `FACILIS_INITIAL_ADMIN` email **and the bootstrap token** in the preview (D-150); the dev fallback verifies the address immediately (D-156). | The todo app is authenticated: create/complete a todo works. |
| 0:55 | Open the **Data** view (database icon). | Tables with columns, RLS badges on the scoped tables, reverse route usage, and *"Code and database are in sync"*. |
| 1:10 | Open **AI Chat** → settings → provider **Mock (dev)** → send any prompt. | The answer streams; the mock writes `src/chat-demo.ts` through the write tools (the clean-tree gate may ask to commit first) and ends with a summary. |
| 1:30 | **Undo this turn** in the git-changes footer. | The file is restored from HEAD and disappears from the footer and the Explorer. |
| 1:45 | (Optional, with a real key) ask *"add a due date to the todo form"*. | The gate commits with a generated message, the AI writes file by file, and the footer lists what changed; the preview hot-updates (HMR). |
| 2:10 | In the preview's address bar append `/_openapi.json`. | Every route carries `x-db-tables`/`x-permission`; the API contract is the spec. |
| 2:30 | **Source Control** → stage the chat change → commit. | A normal commit on the VFS; pushing needs a token and the same-origin proxy (D-079, optional for the demo). |
| 2:50 | Done. | Under three minutes, no backend, no account on the Studio. |

## What the script must not skip

- The **validator** runs on every write: `validate` can pre-check a multi-file change, and
  `write_file`/`delete_file` validate before `applyPatch()` (D-084). A rejected write returns its
  findings and nothing is written.
- The **entity explorer** compares `db/schema.ts` with the live catalog (D-083): after a schema
  patch the Data view shows the drift disappear once the dev boot reconciles the declared schema
  (no migration file to run; D-158).
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
  fixed write script and a summary so the gate/write/footer/Undo path can be demonstrated without a
  key (D-045/D-192).
- A **managed** build (D-063) turns AI and imports off by policy; run the demo against the
  `open` profile.
- If the preview or the Data view says *unreachable*, the project is still booting: the panels
  are throw-free by design and recover on the next revision poll.
