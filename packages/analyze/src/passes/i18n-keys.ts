/**
 * D-218 diagnostic: one warning per `t(...)` call whose key is not a string literal. The
 * analyzer can see the argument shape (identifier, call, concatenation, template with
 * expressions) but not the key, so the call cannot be checked against the catalogue. A
 * warning is the right weight: the app still runs, and the runtime is unchanged.
 */

import { warning } from "../diagnostics.ts";
import type { Diagnostic, FileFacts, TranslationKeyKind } from "../types.ts";

export const I18N_DYNAMIC_KEY_CODE = "i18n-dynamic-key";

function describe(kind: TranslationKeyKind): string {
  switch (kind) {
    case "identifier":
      return "a variable";
    case "call":
      return "a function call";
    case "concatenation":
      return "a concatenation";
    case "template":
      return "a template literal with expressions";
    case "expression":
      return "an expression";
  }
}

/** Diagnostics for every non-literal t() key in the project (warn-only, D-218). */
export function dynamicTranslationKeyDiagnostics(
  fileFacts: readonly FileFacts[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const facts of fileFacts) {
    for (const call of facts.dynamicTranslationCalls) {
      diagnostics.push(
        warning(
          I18N_DYNAMIC_KEY_CODE,
          "t() key is " +
            describe(call.kind) +
            ", so it cannot be verified against locales/en.json (warning only). Use a literal key where possible.",
          call.source,
        ),
      );
    }
  }
  return diagnostics;
}
