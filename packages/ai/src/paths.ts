/**
 * Project-relative path predicates shared by the validator rules (SPEC §9.3 rule 11).
 *
 * Paths are always compared in their normalized, root-relative form ("src/App.tsx"), so
 * Windows separators or a leading "./" never change a rule's verdict.
 */

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** The project files whose facts the validator treats specially. */
export const CONFIG_PATH = "facilis.config.ts";
export const SCHEMA_PATH = "db/schema.ts";
export const LOCALES_PATH = "locales/en.json";

/** Roots a patch may write to (SPEC §9.3 rule 11). */
export const ALLOWED_ROOTS = ["server/", "src/", "db/", "lib/", "components/", "locales/"];

/**
 * The one root file a patch may touch: rule 16 exists because a new permission/role is
 * declared in facilis.config.ts in the same patch, so a blanket root-file rejection would
 * make the 16-rule contract self-contradictory (D-084).
 */
export const ALLOWED_ROOT_FILES = new Set(["facilis.config.ts"]);

export function normalizeProjectPath(path: string): string {
  let normalized = path.trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized.replace(/^\/+/, "");
}

export function isScriptPath(path: string): boolean {
  return SCRIPT_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/** True when the normalized path is inside a root rule 11 allows. */
export function isAllowedWritePath(path: string): boolean {
  return ALLOWED_ROOT_FILES.has(path) || ALLOWED_ROOTS.some((root) => path.startsWith(root));
}
