/**
 * Rule 24 `surface-declared` (D-226): a patch may add a capability only when the code
 * declares it. The analyzer already classifies the effective project; this rule turns a
 * patched undeclared/unknown site into a blocking finding, so the IDE never writes a
 * capability the security export would have to report as undeclared.
 */
import type { EffectiveState } from "../overlay.ts";
import { normalizeProjectPath } from "../paths.ts";
import type { ValidationError } from "../types.ts";

function finding(
  file: string,
  line: number | undefined,
  message: string,
  fix_hint: string,
): ValidationError {
  return {
    rule: "surface-declared",
    severity: "error",
    file,
    ...(line === undefined ? {} : { line }),
    message,
    fix_hint,
  };
}

export function surfaceDeclarationErrors(state: EffectiveState): ValidationError[] {
  const errors: ValidationError[] = [];
  const patched = (file: string): boolean => state.patchedPaths.has(normalizeProjectPath(file));

  for (const route of state.analysis.routes) {
    if (!patched(route.sourceFile)) continue;
    if (route.surface.class !== "undeclared" && route.surface.class !== "unknown") continue;
    errors.push(
      finding(
        route.sourceFile,
        route.source.line,
        "This route is " +
          route.surface.class +
          " surface: no declaration justifies its capability.",
        "Use defineAuthorizedHandler, or declare it with defineRawRoute/rawSql: { reason }/ctx.rawDb ({ reason }) (D-226).",
      ),
    );
  }

  for (const extension of state.analysis.surface.extensions) {
    if (!patched(extension.file)) continue;
    if (extension.surface.class === "declared") continue;
    errors.push(
      finding(
        extension.file,
        extension.surface.source.line,
        "This server extension is " + extension.surface.class + " surface.",
        "Wrap it in defineServerExtension({ reason }, value) (D-226).",
      ),
    );
  }

  for (const entry of state.analysis.surface.forbiddenImports) {
    if (!patched(entry.file)) continue;
    errors.push(
      finding(
        entry.file,
        entry.source.line,
        'Forbidden @facilis.dev/db import "' + entry.imported + '".',
        "Use the declarative db API; createDb/runAs*/ensure* are not a project capability (D-226).",
      ),
    );
  }

  for (const entry of state.analysis.surface.dynamicCode) {
    if (!patched(entry.file)) continue;
    if (entry.surface.class === "declared") continue;
    errors.push(
      finding(
        entry.file,
        entry.surface.source.line,
        "Dynamic code (" + entry.form + ") is " + entry.surface.class + " surface.",
        "Remove it, or declare it with a // dynamic-code: <reason> marker (D-226).",
      ),
    );
  }

  return errors;
}
