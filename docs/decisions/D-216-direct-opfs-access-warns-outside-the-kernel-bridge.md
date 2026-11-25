# D-216 — Direct OPFS access warns outside the kernel bridge
**Status:** accepted (2026-11-25)

Invariant 7 makes the write path structural: Studio writes go through `kernel.writeFiles`
(Vivari VFS), and OPFS is only the kernel's write-behind mirror. Nothing static stopped new
IDE code from reaching for `navigator.storage.getDirectory()`, `showDirectoryPicker()` or a
`FileSystemDirectoryHandle` directly, where the write would bypass the VFS, the preview HMR
signal and the per-tab merge rules (D-036/D-037). The runtime bridge stays the security
authority; this is the additive early warning the epic asks for (issue #174).

**Decision.** `.oxlintrc.json` adds a warning-level override for `ide/**/*.{ts,tsx}` that
restricts the OPFS entrypoints, with `ide/src/vv/**` (the kernel bridge) exempt:

- `no-restricted-properties` (warn) with property-only entries for `getDirectory`,
  `getDirectoryHandle`, `getFileHandle`, `createWritable` and `showDirectoryPicker`.
  These are the calls that open or write OPFS; `getDirectory` is
  `navigator.storage.getDirectory`, the rest are the File System Access calls that acquire or
  write through a `FileSystemDirectoryHandle`/`FileSystemFileHandle`.
- `no-restricted-globals` (warn) for the bare `showDirectoryPicker` global.

Severity is `warn` everywhere, so the restriction never blocks a build; it is enforced
through `pnpm lint` and the IDE's own `oxlint -c ../.oxlintrc.json .`. No analyzer pass and no
AI validator rule are added: unlike the other epic children, this invariant lives only in the
IDE and oxlint can express it, so the validator stays at 23 rules (SPEC §9.3 unchanged).

**Mechanism.**

- oxlint 1.89 has no `no-restricted-syntax` (the rule is not in its ESLint plugin), and its
  `no-restricted-properties` matches only a plain identifier receiver: `{ "object":
  "navigator.storage", "property": "getDirectory" }` does not match
  `navigator.storage.getDirectory()`, and `{ "object": "navigator", "property": "storage" }`
  would ban quota and persistence APIs too. The property-only form is the part of the built-in
  rule that can express the restriction without a custom plugin (epic rule 7), so the
  selectors are name-based rather than path-qualified. A receiver-named method with one of
  these names is OPFS in practice; the current tree has no such call outside the bridge.
- `navigator.storage.estimate()` is deliberately **not** restricted: it reads quota, it does
  not open OPFS, and leaving it out keeps the selector narrower than a blanket
  `navigator.storage` ban. The one current caller, `ide/src/vv/perf-capture.ts`, would pass on
  the selector alone; the allowlist is what keeps the bridge's actual OPFS calls quiet.
- The `ide/**/*.{ts,tsx}` override is a separate block after the `scripts/**`/`packages/db/**`
  overrides; the `ide/src/vv/**` block turns both rules off and is written after it, so the
  bridge is exempt regardless of the directory oxlint is invoked from (verified from the
  repository root and from `ide/`). The existing raw-client `no-restricted-imports` ban is
  untouched.
- The allowlist is the whole kernel bridge, not a file list: `ide/src/vv/**` is the Facilis
  fork's kernel-bridge layer (D-030) and the one place allowed to drive the OPFS mirror —
  `boot-flags.ts` (`getDirectory`), `perf-capture.ts` (`estimate`), and the VFS, cache,
  lock and restore modules around them (D-036/D-037). Exempting the directory rather than two
  files keeps an upstream sync from turning inherited bridge code into a warning storm while
  the boundary that matters (anything under `ide/src/facilis/`, `ide/src/components/`,
  `ide/src/ai/`) stays watched. No upstream-inherited file outside `ide/src/vv/**` calls OPFS
  today; `ide/public/sw.js` is JavaScript outside this TypeScript override and `vendor/**` is
  ignored, so neither needs a pin.
- Rollback is the removal of the two override blocks; no code or build configuration depends
  on the warnings.

**Rejected.** An analyzer fact pass or an AI validator rule: the analyzer sees project source,
not the IDE's own modules, and the epic's validator trail exists for AI-written project code.
A custom oxlint JS plugin: upstream alpha (epic rule 7). Restricting `navigator.storage`
wholesale: it would flag harmless quota probes and still miss a handle acquired from a variable.
A dotted selector through `no-restricted-syntax`: not available in oxlint 1.89. Banning
`FileSystemDirectoryHandle` type annotations instead of the calls: types are erased and do not
write anything, so the call site is the right warning.

**Consequences.** A new direct OPFS call in the IDE outside the bridge shows up as a lint
warning with the invariant-7 remedy; the bridge keeps working unchanged. The list must be
re-read on an oxlint upgrade: if `no-restricted-syntax` lands, the property-only selectors can
be narrowed to `CallExpression[callee.property.name=…]` paths and this decision updated.

**Verification.** A scratch `ide/src/facilis/scratch-opfs-probe.ts` using all six entrypoints
produced 6 warnings and 0 errors from the root config; the same file under `ide/src/vv/`
produced 0 warnings; both scratch files were deleted. `pnpm lint`, `pnpm typecheck`,
`pnpm test` and `pnpm build` pass, and `pnpm ide:smoke` is green.
