/**
 * Project-relative path predicates shared by the validator rules (SPEC §9.3 rule 11).
 *
 * Paths are always compared in their normalized, root-relative form ("src/App.tsx"), so
 * Windows separators or a leading "./" never change a rule's verdict.
 *
 * Rule 11's writable set follows the deployment profile (D-167). A `managed` build keeps
 * the six source roots (D-084); an `open` build accepts the whole project minus the
 * machine surfaces a patch must never touch: dependencies, install state, VCS/IDE state,
 * build output and the project's own instruction file.
 */

import type { WritePolicy } from "./types.ts";

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** The project files whose facts the validator treats specially. */
export const CONFIG_PATH = "facilis.config.ts";
export const SCHEMA_PATH = "db/schema.ts";
export const LOCALES_PATH = "locales/en.json";

/** Roots a `managed` patch may write to (SPEC §9.3 rule 11, D-084). */
export const ALLOWED_ROOTS = ["server/", "src/", "db/", "lib/", "components/", "locales/"];

/**
 * The one root file a `managed` patch may touch: rule 16 exists because a new
 * permission/role is declared in facilis.config.ts in the same patch, so a blanket
 * root-file rejection would make the 17-rule contract self-contradictory (D-084).
 */
export const ALLOWED_ROOT_FILES = new Set(["facilis.config.ts"]);

/**
 * Directory segments no `open` patch may write into (D-167). They are the same entries
 * the PTC read policy hides (docs/PTC.md §6): dependencies, VCS and IDE state, and build
 * output the Explorer does not review. A patch writing them could hide its own changes,
 * poison a cache, or add code without an install.
 */
export const DENIED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".facilis",
  "dist",
  ".turbo",
  "coverage",
]);

/**
 * File names no `open` patch may write (D-167). The install surface is the dependency
 * manifest, the lockfiles and the npm config; AGENTS.md stays IDE-writer-only because it
 * persists instructions into every later session (D-084).
 */
export const DENIED_FILES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".npmrc",
  "AGENTS.md",
]);

export function normalizeProjectPath(path: string): string {
  let normalized = path.trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized.replace(/^\/+/, "");
}

export function isScriptPath(path: string): boolean {
  return SCRIPT_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/** True when the normalized path is writable under `policy` (rule 11). */
export function isAllowedWritePath(path: string, policy: WritePolicy = "managed"): boolean {
  if (policy === "managed") {
    return ALLOWED_ROOT_FILES.has(path) || ALLOWED_ROOTS.some((root) => path.startsWith(root));
  }
  const segments = path.split("/");
  const name = segments[segments.length - 1] ?? "";
  return !DENIED_FILES.has(name) && !segments.some((segment) => DENIED_SEGMENTS.has(segment));
}
