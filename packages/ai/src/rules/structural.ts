/**
 * Rule 11 `file-path-allowed` plus the two structural checks the parser owns
 * (relative path, content present). These need no project context, so they also run
 * when the parser validates a raw answer before any context is assembled.
 */

import { isAllowedWritePath, normalizeProjectPath } from "../paths.ts";
import type { FilePatch, ValidationError } from "../types.ts";

const UNSAFE_SEGMENTS = new Set(["..", "."]);

function error(rule: string, file: string, message: string, fix_hint: string): ValidationError {
  return { rule, severity: "error", file, message, fix_hint };
}

export function structuralErrors(
  patches: readonly FilePatch[],
  allowedRootFiles: readonly string[] = [],
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const patch of patches) {
    const path = normalizeProjectPath(patch.path);
    const segments = path.split("/");
    const unsafe =
      patch.path.trim().length === 0 ||
      patch.path.startsWith("/") ||
      segments.some((segment) => UNSAFE_SEGMENTS.has(segment));
    if (unsafe) {
      errors.push(
        error(
          "file-path-allowed",
          patch.path,
          "Patch paths must be relative to the project root.",
          "Use a project-relative path with no leading slash and no '..' segment.",
        ),
      );
      continue;
    }
    if (!isAllowedWritePath(path) && !allowedRootFiles.includes(path)) {
      errors.push(
        error(
          "file-path-allowed",
          patch.path,
          '"' +
            path +
            '" is outside the writable roots (server/, src/, db/, lib/, components/, locales/, facilis.config.ts).',
          "Keep the patch under server/, src/, db/, lib/, components/ or locales/; the only allowed root file is facilis.config.ts.",
        ),
      );
    }
    if (patch.action !== "delete" && (patch.content ?? "").length === 0) {
      errors.push(
        error(
          "content-present",
          patch.path,
          "Create and update patches must include file content.",
          "Emit the complete new file content for every create and update patch.",
        ),
      );
    }
  }
  return errors;
}
