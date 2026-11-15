# Why a reload of a project with data takes 50 s (issue #36)

Measured on the IDE dev build (`pnpm ide:dev`, `scripts/dev/profile-ide.mjs`, headless
Chromium, reused Chrome profile) on 2026-11-15. The project (`facilis-prof`, created and
used through the IDE) is reopened from the OPFS VFS, exactly like a browser refresh.

## What the boot spends its time on

| Boot | VITE ready | preview-open |
|---|---|---|
| project with data (`.facilis/db/snapshot.tar.gz` present) | 38.5 s | 49.0 s |
| same project, `.facilis` deleted before the boot | 38.8 s | 50.1 s |
| newly created project (same profile, same dependency cache) | 3.6 s | 17.0 s |

Deleting `.facilis` changes nothing: the dev database snapshot is **not** the trigger. The
difference is between a **restored** project (its `node_modules` exists when Vite starts)
and a **newly created** one (Vite starts while the tree is still being written).

The CPU profile of the slow boot, per target (`cpu-*.cpuprofile`, 10 s segments):

- `refOf` @ `@facilis.dev/analyze/dist/passes/file-facts.js`: **19.1 s**
- `refOf` @ `@facilis.dev/analyze/dist/module-info.js`: **10.2 s** (+ `lineOf` 2.4 s)
- oxc parsing in rolldown's wasi workers: 41.3 s + 29.9 s, aggregated across workers (parallel)
- PGlite: the module is loaded, no measurable self time; `PGlite.create({ loadDataDir })`
  restores a 4.75 MB snapshot in 216 ms (warm) / 348 ms (cold process) on the host.

So ~27 s of the 38.5 s Vite startup is `@facilis.dev/analyze` computing a line number per
import/export/usage node. The old `lineOf` walked the source from offset 0 for every node:
O(nodes × file size) per file. The boot analyzer reads the project **and every
`@facilis.dev` package source it imports** — 1,199 files / 5.6 MB on `examples/todo-app` —
because the module graph resolves imports through `node_modules/@facilis.dev`. Everything
runs synchronously in the Vite process, the process that must answer the module runner's
`fetchModule` calls: hence the 2 s `__vv.diag()` plateau (the kernel's per-process heap
query budget) and the 60 s `fetchModule` timeout on slower machines.

## Fix

`packages/analyze` indexes each file's newline offsets once (`sourceLines`), stores the
index on `ProjectFile` and resolves every position with a binary search. No contract
change: the facts, line numbers and diagnostics are identical (the index reproduces the
old scan exactly, covered by `source.test.ts`).

Verification:

- Unit tests: 176 analyzer tests pass, including the new line-number equivalence test.
- Host benchmark (`analyzeProject` over `examples/todo-app`): 832 ms → 650-690 ms. The
  remaining cost is oxc parsing; the 646 ms floor measured with the line scans stubbed
  out matches the new time, i.e. the scans are gone.
- In the WebContainer, with the indexed lookup injected over the published analyzer in
  the guest (the exact algorithm this change ships, read back from the VM to prove the
  write landed): **preview-open 49.0 / 50.1 s → 15.0 / 15.6 s** over two runs,
  **VITE ready 38.5 s → 4.0 s**, and `refOf` disappears from the profile (0.0 s). 15 s is
  the same order of magnitude as a newly created project (17 s), which is issue #36's
  acceptance criterion.
- Dev database persistence (D-052) is untouched: `snapshot.tar.gz` is still read and
  written exactly as before, so data keeps surviving a refresh.

## Follow-ups (not in this change)

- The remaining boot cost is oxc parsing 1,199 framework files that ship both `src` and
  `dist`; parsing only what the project actually imports would cut it further.
- The snapshotter treats a read as a change (`activity()` counts `query`/`exec`/
  `transaction`, reads included), so a polling UI dumps the whole cluster (~344 ms, 4.75 MB)
  every second. Fixing the change signal is a separate change with its own D-052 note.
