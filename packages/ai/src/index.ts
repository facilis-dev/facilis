/**
 * @facilis/ai — prompt assembly, response parsing and the patch validator.
 *
 * Phase 0 skeleton: `validatePatch` performs the structural checks that need no
 * TypeScript program (path safety, payload presence). The full 16-rule validator
 * (spec §9.3) arrives in Phase 4.
 */

export interface FilePatch {
  path: string;
  action: "create" | "update" | "delete";
  content?: string;
}

export interface ValidationError {
  rule: string;
  severity: "error" | "warning";
  file: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

const PATH_SEGMENTS = new Set(["..", "."]);

function validateFilePatch(patch: FilePatch): ValidationError[] {
  const errors: ValidationError[] = [];
  const segments = patch.path.split("/");
  const isUnsafePath =
    patch.path.trim().length === 0 ||
    patch.path.startsWith("/") ||
    segments.some((s) => PATH_SEGMENTS.has(s));

  if (isUnsafePath) {
    errors.push({
      rule: "file-path-allowed",
      severity: "error",
      file: patch.path,
      message: "Patch paths must be relative to the project root.",
    });
  }

  if (patch.action !== "delete" && (patch.content ?? "").length === 0) {
    errors.push({
      rule: "content-present",
      severity: "error",
      file: patch.path,
      message: "Create and update patches must include file content.",
    });
  }

  return errors;
}

export function validatePatch(patches: readonly FilePatch[]): ValidationResult {
  const errors = patches.flatMap(validateFilePatch);

  return { ok: errors.length === 0, errors, warnings: [] };
}
