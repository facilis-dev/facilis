/**
 * Rule 13 `i18n-keys-registered` (warning, SPEC §9.3): every static `t("key")` call in
 * a patched file must have its key in the effective default-locale catalogue. Keys are
 * literal facts from the analyzer: an interpolated key cannot be checked and guessing would
 * produce false warnings.
 */

import { LOCALES_PATH, type EffectiveState } from "../overlay.ts";
import { isScriptPath } from "../paths.ts";
import type { ValidationError } from "../types.ts";

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
  }
  return warnings;
}
