# Spike results — Tailwind v4 + Base UI inside the WebContainer

Status: **substrate works**, with one concrete caveat (Tailwind HMR for new utility classes).
Date: 2026-11-03. Environment: this host, headless Chrome, real Studio + real WebContainer,
fresh browser profile, cold in-VM install.

## What was run

`spikes/tailwind-vm/run.mjs` patches `examples/todo-app` for the duration of the run
(Tailwind plugin + one probe component + lean deps), creates a project through the real
Studio UI, waits for the in-VM install and Vite dev server, then asserts the probe in the
preview. A control run (`SPIKE_CONTROL=1`) does the same with the untouched template.
The template is restored in `finally`; `git diff` is empty after every run.

Dependencies under test (exact, deliberately lean):

- `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`, `@tailwindcss/oxide-wasm32-wasi@4.3.3`
- `@base-ui/react@1.9.0`, `clsx`
- no `shadcn` CLI, no `class-variance-authority`, no `tw-animate-css` (see below)

## Results

| Check | Result |
|---|---|
| in-VM `npm install` with Tailwind + base UI | PASS |
| Vite 8.3.5 dev server starts (`--configLoader native`) | PASS |
| preview paints | PASS |
| Tailwind utilities generated and applied | PASS (`bg-red-500` -> `oklch(0.637 0.237 25.331)`) |
| Base UI primitive renders | PASS (button) |
| HMR: new utility class after a source edit | **FAIL** (known WASI scanner bug) |
| HMR: after touching the stylesheet | PASS (workaround) |

### Timings (this environment)

| | control (no Tailwind) | Tailwind + Base UI | delta |
|---|---|---|---|
| create -> preview paint | 112.7 s | 116.8 s | +4.2 s |
| install done | 104.6 s | 108.7 s | +4.1 s |
| Vite ready | 1.47 s | 1.77 s | +0.3 s |
| packages | 86 | 112 | +26 |
| node_modules | 7,625 files / 102.4 MB | 12,146 files / 144.9 MB | +42.5 MB |
| dev CSS | — | ~70 KB | — |

The cold-create cost delta is small in this environment; the install is dominated by
network/registry time, not by the new packages.

### The one blocker: Tailwind HMR for new utility classes

Reproduced exactly the open WASI incremental-scan bug
(tailwindlabs/tailwindcss#20605, open as of 2026-10-21):

1. preview renders `bg-red-500` correctly;
2. editing the probe source to `bg-emerald-500` lands in the VFS and the DOM class changes,
   but the generated CSS does not contain `.bg-emerald-500` (`cssHasEmerald: false`), so the
   element has no background;
3. touching `src/styles.css` (a comment) recreates the scanner, the rule appears and the
   background becomes `oklch(0.696 0.17 162.48)`.

Cause: inside WebContainer, Vite uses Tailwind's WASI scanner; its incremental source
scanning misses new candidates after a file change. This is dev-server-only behavior in the
VM: the IDE's own Tailwind build is host-side and unaffected.

Impact: the Studio's live-edit promise is degraded for classes added by an edit (text HMR
still works). Options: wait for the upstream fix, or add an IDE-side HMR hook that forces a
CSS rescan after writes. This must gate adoption, not the substrate feasibility.

## Notes

- The VM's Node reports `process.arch = wasm32`, so `cpu: wasm32` packages are a normal
  platform match: `@tailwindcss/oxide-wasm32-wasi` installs without `--force`, and native
  oxide binaries are not needed. Pin the three Tailwind packages to the same exact version
  (4.3.4 vs 4.3.3 skew was observed in an earlier attempt).
- A first attempt that included the `shadcn` CLI package (plus cva/tailwind-merge/tw-animate-css)
  did not finish installing within 7 minutes (~1 GB of requests in the status bar). The shadcn
  CLI is not needed at runtime; vendor its small base CSS instead.
- Not covered here: production build inside the VM (the deploy build runs outside the VM),
  the full shadcn theme CSS, complex Base UI primitives, template migration, managed/offline.

## Artifacts

- `results/tailwind-report.json` — full run report (checks, timings, terminal samples)
- `results/control-report.json` — baseline run report
- `results/tailwind-preview.png` — preview with the Tailwind + Base UI probe
- `run.mjs` — the driver (temporary template patch, restored)
- `diag.mjs`, `diag2.mjs` — in-VM diagnostics used while debugging the first runs
