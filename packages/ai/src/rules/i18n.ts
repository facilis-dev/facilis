/**
 * Rule 13 `i18n-keys-registered` (warning, SPEC §9.3): every static `t("key")` call in a
 * patched file must have its key in the effective default-locale catalogue, a non-literal
 * `t()` key is reported as unverifiable, and every secondary `locales/*.json` must keep
 * parity with `locales/en.json` in both directions (D-218). Keys and catalogues are
 * analyzer facts over the effective post-patch analysis: a dynamic key is never guessed and
 * a malformed catalogue keeps its existing warning and is skipped.
 */

import { localeParityGaps } from "@facilis.dev/analyze";

import { LOCALES_PATH, type EffectiveState } from "../overlay.ts";
import { isScriptPath } from "../paths.ts";
import type { ValidationError } from "../types.ts";

function secondaryPath(locale: string): string {
  return "locales/" + locale + ".json";
}

export function i18nWarnings(state: EffectiveState): ValidationError[] {
  const warnings: ValidationError[] = [];
  if (!state.localesValid) {
    warnings.push({
      rule: "i18n-keys-registered",
      severity: "warning",
      file: LOCALES_PATH,
      message:
        "The patched locales/en.json is not a valid JSON catalogue, so i18n keys cannot be verified.",
      fix_hint: "Emit locales/en.json as a complete JSON object of key/value strings.",
    });
  }
  const known = new Set(Object.keys(state.locales));
  for (const facts of state.patchedFileFacts) {
    if (!isScriptPath(facts.path)) continue;
    const reported = new Set<string>();
    for (const call of facts.translationCalls) {
      if (known.has(call.key) || reported.has(call.key)) continue;
      reported.add(call.key);
      warnings.push({
        rule: "i18n-keys-registered",
        severity: "warning",
        file: facts.path,
        message: 't("' + call.key + '") is not registered in locales/en.json.',
        fix_hint: "Add the key to locales/en.json in the same patch, or reuse a registered key.",
        line: call.source.line,
      });
    }
    for (const call of facts.dynamicTranslationCalls) {
      warnings.push({
        rule: "i18n-keys-registered",
        severity: "warning",
        file: facts.path,
        message:
          "A t() call uses a non-literal key, so it cannot be verified against locales/en.json.",
        fix_hint:
          'Use a literal t("key") call where possible; a dynamic key is never guessed by the validator.',
        line: call.source.line,
      });
    }
  }
  // The catalogue files are project-level facts: a gap is reported once per key/direction
  // over the effective (post-patch) analysis, not once per patched file.
  for (const gap of localeParityGaps(state.analysis.locales)) {
    const secondary = secondaryPath(gap.locale);
    const missingFrom = gap.direction === "missing-from-secondary" ? secondary : LOCALES_PATH;
    const presentIn = gap.direction === "missing-from-secondary" ? LOCALES_PATH : secondary;
    warnings.push({
      rule: "i18n-keys-registered",
      severity: "warning",
      file: missingFrom,
      message:
        'locale key "' +
        gap.key +
        '" is in ' +
        presentIn +
        " but missing from " +
        missingFrom +
        ".",
      fix_hint: "Keep locales/en.json and every secondary catalogue on the same key set.",
    });
  }
  return warnings;
}
