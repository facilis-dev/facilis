# D-026 — Known: Monaco 0.55.1's TS worker throws on "cannot find module" diagnostics
**Status:** accepted as a known upstream defect (2026-10-28); not Phase 2 blocking

The first content change in a JS/TS model makes `ts.worker` compute diagnostics for every
background model. A diagnostic whose module resolution failed carries TS 6.0's
`repopulateInfo` callback; Monaco's `clearFiles()` spreads that diagnostic into the worker
reply, and structured clone rejects the function:

`DataCloneError: Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope': () => ({
moduleReference, mode, packageName: … }) could not be cloned.`

The Facilis template triggers it because its `tsconfig.json` aliases `"~/*"`, which the
Studio's TS language service does not read (it configures fixed compiler options), so
`"~/db/schema"` is unresolved in the editor. `scripts/dev/smoke-ide.mjs` therefore filters
exactly this error (`/could not be cloned/`) out of its "no page errors" assertion and
records it as `knownPageErrors` in `report.json`. It is an editor/worker defect, not a VFS
one: the write + HMR path is unaffected.

**Follow-up:** load each project's `tsconfig.json` `paths`/`baseUrl` into
`typescriptDefaults` (fixes the alias, and with it most of the noise for Facilis projects),
and/or bump `monaco-editor` once upstream stops spreading non-cloneable diagnostics.
