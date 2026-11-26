# D-218 — i18n parity and dynamic t() keys warn
**Status:** accepted (2026-11-25)

Rule 13 only checked literal `t()` keys against the effective default catalogue: a computed key
was invisible, so a typo in a dynamic key could never be flagged, and a key added to
`locales/en.json` could silently stay untranslated in every other catalogue. Both are quality
gaps, not runtime defects — the app still renders and the missing-key fallback still works — so
the epic's additive early-warning layer applies (epic 168 design rules 1 and 2): report them,
never block a write.

**Decision.** Extend the per-file translation facts with a `dynamicTranslationCalls` list and
report analyzer diagnostic `i18n-dynamic-key` (warning) once per non-literal `t()` call. Report
analyzer diagnostic `i18n-locale-parity` (warning) once per key/direction whenever
`locales/en.json` and a secondary `locales/*.json` disagree on their key set. Extend AI
validator rule 13 `i18n-keys-registered` with both warnings over the effective post-patch
facts; the validator stays at 23 rules. Additive: no runtime boundary changes, and rollback is
the removal of the new facts, the new pass, the parity helper and the rule-13 extension.

**Mechanism.**

- `packages/analyze/src/passes/file-facts.ts` classifies the first argument of every `t()`
  call. A string literal or an expression-free template is a `TranslationCallFact` as before;
  the analyzer's `templateString` already unwraps a single-quasi template to its literal value,
  so a static template is never a dynamic call. Anything else becomes a
  `DynamicTranslationCallFact` carrying only the argument shape — `identifier`, `call`,
  `concatenation` (a `+` binary expression), `template` (a template with expressions) or
  `expression` (the fallback, including a call with no argument) — plus its source. No key is
  guessed and no source text is re-parsed: the parser produced the node, the pass only reads it.
- `packages/analyze/src/passes/i18n-keys.ts` turns each dynamic fact into one `i18n-dynamic-key`
  warning that names the argument shape and says the key cannot be verified. `analyzeProject`
  appends the diagnostics after the locale pass; the existing `node_modules` filter keeps
  framework calls out of the project's diagnostics.
- `packages/analyze/src/locale-parity.ts` is the one shared parity computation:
  `localeParityGaps` compares every secondary catalogue with `en` in both directions and emits
  `missing-from-secondary` / `missing-from-default` gaps, ordered by secondary locale name and
  then key. `packages/analyze/src/passes/i18n.ts` maps a gap to one `i18n-locale-parity` warning
  whose source is the file where the key is missing; a malformed catalogue is not in the
  `locales` fact map, so it keeps its single `i18n-catalog` warning and contributes no parity
  warning. The default is `locales/en.json` by contract (the same baseline rule 13 already
  verifies against); `config.i18n.defaultLocale` is not consulted, which keeps the result
  deterministic and avoids a second, config-dependent notion of "default". A missing or
  malformed `en` catalogue yields no parity warnings because there is no baseline to compare.
- `packages/ai/src/rules/i18n.ts` reads `state.patchedFileFacts` (dynamic calls in the patched
  files) and `state.analysis.locales` (the effective post-patch catalogues) through the same
  `localeParityGaps` helper, so the analyzer and the validator cannot drift on the gap set. Both
  findings are `warning` on rule 13 `i18n-keys-registered`; a malformed patched
  `locales/en.json` keeps its existing single warning and adds no parity noise.
- IDE catalogues are deliberately out of scope for this fact pass: `ide/src/i18n/en.ts` and
  `it.ts` are TypeScript modules with flat object literals spread across sibling modules, not
  project `locales/*.json` files, and the analyzer's locale facts only read `locales/` JSON in
  the analyzed project map. The IDE already ships `ide/src/i18n/i18n.test.ts`, which enforces
  that Italian only translates keys that exist in English and preserves placeholders; missing
  translations fall back to English by design and the IDE is translated incrementally. No
  bespoke IDE harness is added, and the analyzer parity check covers generated projects only.

**Rejected.** A sibling validator rule: rule 13 already owns "keys are registered", so extending
it keeps the validator at 23 rules and every rule-count reference unchanged. Evaluating a
dynamic argument to recover its key: that is execution/guessing, and the epic's facts-not-text
rule forbids it; the warning is the honest outcome. Skipping static templates because they look
different from strings: the existing unwrapping already makes them literal, and warning on them
would be a false positive. Comparing against `config.i18n.defaultLocale`: rule 13's contract is
English, and a config-driven baseline would make the analyzer and validator disagree when the
config is itself patched. Adding a bespoke IDE parity harness: the analyzer facts cannot reach
the IDE's TS catalogues without a new loader, which the issue explicitly does not require.

**Consequences.** A project with a computed key sees one warning per call in
`Analysis.diagnostics` (IDE diagnostics, patch feedback) and in the AI validator's review; a
project with an untranslated key sees one warning per key/direction. Because parity is a
project-level fact, an AI patch also sees pre-existing catalogue gaps as warnings — which is
intended guidance and never blocks the write. The shipped examples produce no parity warnings;
their existing dynamic calls now warn (docs-app 5, showcase-app 12, starter-app 6, todo-app 18
at this commit) and never error. Rollback removes the two fact fields, the two passes, the
shared helper, the rule-13 extension and the SPEC row.

**Verification.** `packages/analyze/src/passes/file-facts.test.ts` (literal vs dynamic kinds,
static templates stay literal); `packages/analyze/src/passes/i18n-keys.test.ts` (one warning per
non-literal argument, silent on literals/static templates, fixture's three calls);
`packages/analyze/src/passes/i18n.test.ts` (missing secondary key, secondary-only key, malformed
catalogue skipped, missing default baseline, deterministic order);
`packages/analyze/src/i18n-gate.test.ts` (failing/passing fixtures plus the shipped examples,
warnings-only and reported counts); `packages/ai/src/validator-i18n.test.ts` (dynamic calls,
both parity directions, effective post-patch catalogue, malformed catalogue) and the updated
`packages/ai/src/validator-facts.test.ts`; `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`.
