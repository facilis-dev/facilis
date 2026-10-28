# PR draft — fix(runtime): import.meta.resolve returns a URL, not a path

**Status:** draft, **not pushed** (2026-10-28). Branch `fix/import-meta-resolve-url` based on
`v1.1.2` (`1f00a48c`); commit `240f564`. Apply with
`git am docs/upstream/vivari-import-meta-resolve.patch` (includes the changeset).

**Base repo:** [maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari)

## Summary

Node's `import.meta.resolve()` returns a **URL string** — `file:///…` for a module on disk,
`node:fs` for a core builtin. The ESM prelude handed back whatever `require.resolve()`
returned, i.e. a bare filesystem path. Code that follows Node's documented shape —
`fileURLToPath(import.meta.resolve(…))` — threw `TypeError: Invalid URL` on a module that had
resolved perfectly. Nitro's `node-worker`/`node-process` dev runners do exactly that
(`fileURLToPath(import.meta.resolve(entry))`), so they cannot start in the VM at all.

## Change

- `packages/runtime/esm.js` (`importMetaSource`): build a `file://` URL from the resolved
  path (each segment percent-encoded) and prefix `node:` for builtins — the Node behaviour for
  the specifiers tools actually pass.
- `scripts/spike-bun-offline.mjs`: pins the three forms (relative file, bare package, builtin +
  subpath). Without the change those three checks fail.

## Verification

- `node scripts/spike-bun-offline.mjs`: **PASS** with the change; the new checks **fail** with
  it stashed (verified).
- Not exercised end-to-end in the VM: the Facilis template keeps
  `devServer: { runner: "self" }`, so Nitro does not take the runner path that uses this call
  today. The patch removes the `Invalid URL` half of that blocker; the rest of the runner's
  viability inside the WebContainer still has to be measured once this ships.
- Changeset included: `.changeset/quiet-meta-resolves.md` (`@vivari/core`, patch).
