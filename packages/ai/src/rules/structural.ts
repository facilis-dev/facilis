/**
 * Rule 11 `file-path-allowed` plus the two structural checks the parser owns
 * (relative path, content present). These need no project context, so they also run
 * when the parser validates a raw answer before any context is assembled.
 *
 * The writable set follows the deployment profile (D-167): the finding keeps its rule id
 * and severity, only the message and the fix hint change with the policy.
 */

import { isAllowedWritePath, normalizeProjectPath } from "../paths.ts";
import type { FilePatch, ValidationError, WritePolicy } from "../types.ts";

const UNSAFE_SEGMENTS = new Set(["..", "."]);

const MANAGED_MESSAGE =
  " is outside the writable roots (server/, src/, db/, lib/, components/, locales/, facilis.config.ts).";
const MANAGED_HINT =
  "Keep the patch under server/, src/, db/, lib/, components/ or locales/; the only allowed root file is facilis.config.ts.";
const OPEN_MESSAGE =
  " is write-protected: a patch may not write dependencies, install state, VCS/IDE state or the project instruction file.";
const OPEN_HINT =
  "Choose a project source or config file; node_modules/, package.json, lockfiles, .npmrc, .git/, .facilis/, dist/, .turbo/, coverage/ and AGENTS.md are never written by a patch.";

function error(rule: string, file: string, message: string, fix_hint: string): ValidationError {
  return { rule, severity: "error", file, message, fix_hint };
}

export interface StructuralOptions {
  /** Root files the caller's own writer may touch (never an AI patch). */
  allowedRootFiles?: readonly string[];
  /** Rule 11's writable set. Defaults to `managed` (fail-closed). */
  writePolicy?: WritePolicy;
}

export function structuralErrors(
  patches: readonly FilePatch[],
  options: StructuralOptions = {},
): ValidationError[] {
  const allowedRootFiles = options.allowedRootFiles ?? [];
  const writePolicy = options.writePolicy ?? "managed";
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
    if (!isAllowedWritePath(path, writePolicy) && !allowedRootFiles.includes(path)) {
      const open = writePolicy === "open";
      errors.push(
        error(
          "file-path-allowed",
          patch.path,
          '"' + path + '"' + (open ? OPEN_MESSAGE : MANAGED_MESSAGE),
          open ? OPEN_HINT : MANAGED_HINT,
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
