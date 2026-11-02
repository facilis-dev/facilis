/**
 * Rule 13 `i18n-keys-registered` (warning, SPEC §9.3): every static `t("key")` call in
 * a patched file must have its key in the effective `locales/en.json`. Static keys only:
 * an interpolated key cannot be checked, and guessing would produce false warnings.
 */

import { LOCALES_PATH, type EffectiveState } from "../overlay.ts";
import { isScriptPath } from "../paths.ts";
import { lineAt, tCallKeys } from "../scan.ts";
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
  for (const source of state.patchedSources) {
    if (!isScriptPath(source.path)) continue;
    const reported = new Set<string>();
    for (const call of tCallKeys(source.content)) {
      if (known.has(call.key) || reported.has(call.key)) continue;
      reported.add(call.key);
      warnings.push({
        rule: "i18n-keys-registered",
        severity: "warning",
        file: source.path,
        message: 't("' + call.key + '") is not registered in locales/en.json.',
        fix_hint: "Add the key to locales/en.json in the same patch, or reuse a registered key.",
        line: lineAt(source.content, call.index),
      });
    }
  }
  return warnings;
}
