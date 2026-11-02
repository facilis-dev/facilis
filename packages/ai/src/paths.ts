/**
 * Project-relative path predicates shared by the validator rules (SPEC §9.3 rule 11).
 *
 * Paths are always compared in their normalized, root-relative form ("src/App.tsx"), so
 * Windows separators or a leading "./" never change a rule's verdict.
 */

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

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

export function isModularPath(path: string): boolean {
  return (
    path.endsWith(".ts") ||
    path.endsWith(".tsx") ||
    path.endsWith(".js") ||
    path.endsWith(".jsx") ||
    path.endsWith(".mjs") ||
    path.endsWith(".cjs")
  );
}

export function isRoutePath(path: string): boolean {
  return normalizeProjectPath(path).startsWith("server/routes/") && isModularPath(path);
}

export function isMigrationPath(path: string, migrationsDir: string): boolean {
  const normalized = normalizeProjectPath(path);
  const directory = normalizeProjectPath(migrationsDir).replace(/\/+$/, "");
  return normalized.startsWith(directory + "/") && normalized.endsWith(".sql");
}

/** True when the normalized path is inside a root rule 11 allows. */
export function isAllowedWritePath(path: string): boolean {
  return ALLOWED_ROOT_FILES.has(path) || ALLOWED_ROOTS.some((root) => path.startsWith(root));
}
