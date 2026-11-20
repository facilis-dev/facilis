# D-103 — The chat has one mode: PTC is always on
**Status:** accepted (2026-11-07)

The user asked to remove the non-PTC chat mode after testing the tool runtime. Keeping two paths
(preloaded context without tools, and the tool runtime behind a dev flag) doubles the surface and
lets the weaker path drift: the repair loop still carried an inline-file fallback, the prompt had
a tools/no-tools branch, and the production build behaved differently from the one under test.

**Decision.**

- `PTC_ENABLED` and `ide/src/ai/ptc/flags.ts` are gone: `chat-host.ts` always constructs the
  runner (`createPtcRunner` with a per-run tool router) and `ChatSessionOptions.runner` is a
  required field.
- `runTurn` requires the runner; there is no "tool runtime unavailable" branch and no prompt
  mode switch.
- The D-100 inline-file repair fallback is removed: the correction always sends the fix plan and
  tells the model to `read_file` the implicated files and to `validate` the exact set it will
  return (D-102).
- Production now needs the per-path headers for `/ptc-runner.html` (CSP
  `default-src 'none'; script-src 'unsafe-inline'; worker-src blob:` plus the site's COOP/COEP).
  They ship in `ide/public/_headers` (Cloudflare Pages) and in `ide/vite.ptc.ts` for
  dev/preview; another host must reproduce them. Without the CSP the iframe keeps its opaque
  origin but loses the egress block, so the header is a deployment requirement (PTC.md §5).
- The dev mock's "ptc"/"esplora" trigger stays as a no-key way to exercise the trace.
- Model A's context assembly (file list, config, manifest, AGENTS.md) stays as context, not as a
  second mode: removing it would make every first turn start blind.

**Rejected alternatives.** *Keep a fallback switch*: two chat behaviours to test and document,
and the tool runtime already covers the fallback's use cases. *Remove the preloaded context too*:
it is context assembly, not a mode. *Keep the dev flag until the eval corpus exists*: the user
wants the single path now; the eval corpus still tunes budgets but no longer gates a second mode.

**Consequences.** Every chat turn uses the PTC runtime (and therefore needs the runner page
served with its headers). The pre-PTC path remains in the spec as history (Model A, D-045/D-046).
Cross-browser isolation is still a gate (PTC.md §13); Chromium only so far.

**Verification.** `ChatSessionOptions.runner` is required and every session test injects one;
the turn loop has no runtime-off branch; `repair.ts` has no file-inlining path; the full gates
are green and `node scripts/dev/check-ptc-runner.mjs` still passes 9/9.
