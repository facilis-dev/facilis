# D-121 — `blocks` is not part of the project config
**Status:** accepted (2026-11-08)

`facilis.config.ts` carried a `blocks: { packages: string[] }` section whose only consumer was
the AI validator's block-import rule: it named extra packages that ship `BlockManifest`s. The
generated project no longer composes external UI packages — the v2 frontend copies Base UI
primitives into `src/components/ui` (D-090, D-096) — so the section described a supply chain
nothing ships.

**Decision.** Remove `blocks` from `FacilisConfig`/`FacilisConfigInput` and its Zod schema (a
config that still declares it fails the strict object check instead of being silently ignored),
from the analyzer's `ConfigFacts.blocksPackages`, and from the example. AI rule 7
(`block-import-valid`) keeps validating imports of the one shipped `@facilis.dev/blocks` package
through its `DEFAULT_BLOCKS_PACKAGE` constant; the manifest's `BlockManifest` contract is
unchanged.

**Consequences:** SPEC §7.1 and Appendix B no longer list the section; the example config shrinks
by one entry. Block discovery (O-004) remains a Phase 5 concern for the shipped package, not a
project knob.
