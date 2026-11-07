# Spike: PTC sandbox (phase 0)

Throwaway feasibility spike (AGENTS.md: never shipped, never imported by packages). It answers
the assumption the [PTC design](../../docs/PTC.md) depends on: **can a model-written JavaScript
program run with no project access, no storage and no network, while the IDE keeps the tool RPC
and stays responsive?**

Run it from the repo root:

    node spikes/ptc-sandbox/run.mjs

Needs the headless Chromium from `pnpm ide:browser` (`$FACILIS_TOOLING_DIR`, default
`/tmp/facilis-dev`). The page is served with the IDE's COOP/COEP headers.

## What it builds

- Host page -> sandboxed iframe (`sandbox="allow-scripts"`, opaque origin) -> blob Worker
  (one per program). The iframe relays async tool calls to the parent over `postMessage`.
- Two runner shapes: `srcdoc` + the Chrome-only `csp=""` attribute, and a same-origin
  `/runner.html` served with a **CSP response header** (the cross-browser production path).
- Probes: parent DOM, localStorage, IndexedDB, OPFS, `fetch`, RPC round trip, worker creation,
  worker restrictions, `terminate()` during a busy loop, and a 1.2 s busy loop in the frame to
  measure parent responsiveness.

## Results — 2026-11-07, Chromium 156.0.8078.47 (headless, COOP/COEP `require-corp`)

21/21 checks passed. `last-run.json` is written by the run (gitignored).

| # | Observed | Implication |
|---|---|---|
| H1 | frame origin is `null`; parent cannot read the frame DOM, the frame cannot read the parent | the `sandbox` attribute alone gives an opaque origin |
| H1 | localStorage, IndexedDB and OPFS are blocked in the frame | no project/IDE storage from the program |
| H2 | `fetch` is blocked by the CSP | no egress from the program |
| H3 | tool RPC round trip works | the tool router can stay in the IDE |
| H5 | the opaque iframe can create a blob Worker | the program can run off the frame's main thread |
| H6 | the worker inherits the restrictions (storage/IDB/fetch blocked, OPFS absent) | no escape through the worker |
| H6 | `worker.terminate()` during a busy loop works, frame main thread delay 200 ms | hard CPU budget without freezing the frame |
| H6 | header-served `/runner.html` is also opaque, storage/fetch blocked | production can avoid the Chrome-only `csp` attribute |
| H4 | a 1.2 s busy loop in the frame delayed the parent timer by **0 ms** | Chromium isolates sandboxed iframes in their own process ("isolated sandboxed iframes"); the IDE cannot be frozen |

## Conclusion

The design holds: **opaque-origin iframe + one blob Worker per program + parent-side tool RPC**
is a workable sandbox. The iframe is always opaque (standard), the CSP header blocks egress
(standard), and the worker gives a portable hard stop via `terminate()`. Process isolation is
a bonus, not something to rely on: use `terminate()` as the contract.

## Caveats

- Only Chromium 156 was exercised. Firefox/Safari are not installed here: rerun the spike in the
  browser matrix before promising PTC in a managed deployment. The iframe/opaque-origin and
  header-CSP parts are standard; process isolation is not guaranteed.
- The real tool results carry project data; this spike only proves transport and isolation, not
  the tool policy (paths, secrets, caps), which is unit-tested in phase 1.
- Retire this spike once the findings land in `docs/PTC.md` and the phase-1 runner exists.
