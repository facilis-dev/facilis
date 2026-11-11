// Which project files the browser analyzer reads (task-6, docs/findings/ast-dsl-contract.md).
//
// Pure and testable — no VFS, no worker. The controller hands in its flat snapshot of
// absolute paths plus the active root; this module decides what belongs to the DSL surface
// and enforces the size caps so a pathological project fails with a clear error instead of
// exhausting browser memory in the wasm parser.

/** Extensions the analyzer can read. JSON carries facilis.config and locale catalogs. */
export const ANALYSIS_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
];

/** Project subtrees that can contain DSL facts (routes, schema, config, pages, locales). */
const INCLUDED_TREES: readonly string[] = ["db/", "server/", "src/", "locales/"];

/** Root files the analyzer reads even though they sit outside the included trees. */
const INCLUDED_ROOT_FILES: ReadonlySet<string> = new Set([
  "facilis.config.ts",
  "package.json",
  "tsconfig.json",
]);

/**
 * Installed framework sources: the @facilis.dev packages ship their `src/`, and the analyzer
 * reads their declarations. The generated project installs with npm (flat node_modules), so
 * the scope is a direct child of the project root.
 */
const INCLUDED_NODE_MODULE_PREFIX = "node_modules/@facilis.dev/";

/** Generated/build artifacts and VCS metadata. Never DSL facts. */
const SKIPPED_SEGMENTS: ReadonlySet<string> = new Set([
  "dist",
  "coverage",
  ".output",
  ".facilis",
  ".git",
  ".turbo",
]);

/** Unit-test fixtures inside an included tree are not project DSL either. */
const SKIPPED_FILE_MARKERS: readonly string[] = [".test.", ".spec."];

/** Larger projects are not analyzable in a browser tab with a 250 MiB wasm instance. */
export const ANALYSIS_MAX_FILES = 1200;

/** Rough byte cap on the snapshot; the maps are UTF-16 strings, so chars >= bytes. */
export const ANALYSIS_MAX_TOTAL_CHARS = 6 * 1024 * 1024;

/** Outcome of the pure selection: project-relative paths, or the reason they are too many. */
export type AnalysisFileSelection =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly error: string };

/** Project-relative path (POSIX separators) of an absolute VFS path, or null outside root. */
export function projectRelativePath(root: string, absolutePath: string): string | null {
  const normalizedRoot = root === "/" ? "" : root.replace(/\/+$/, "");
  const prefix = normalizedRoot + "/";
  if (!absolutePath.startsWith(prefix)) return null;
  const relative = absolutePath.slice(prefix.length);
  return relative.length === 0 ? null : relative;
}

/** Whether a project-relative path contributes facts to the analysis. */
export function isAnalysisPath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  if (segments.length === 0) return false;
  const name = segments[segments.length - 1];
  if (name === undefined || name.length === 0) return false;
  // Empty segments mean "//" or a trailing slash: not a file path.
  if (segments.some((segment) => segment.length === 0)) return false;
  // Dependencies nested anywhere else (workspace links, vendored copies) are not walked.
  if (segments.includes("node_modules") && !relativePath.startsWith(INCLUDED_NODE_MODULE_PREFIX)) {
    return false;
  }
  // A package's own nested node_modules is a second install, not framework source.
  if (relativePath.startsWith(INCLUDED_NODE_MODULE_PREFIX)) {
    const rest = relativePath.slice(INCLUDED_NODE_MODULE_PREFIX.length).split("/");
    if (rest.includes("node_modules")) return false;
  }
  for (const segment of segments.slice(0, -1)) {
    if (SKIPPED_SEGMENTS.has(segment)) return false;
  }
  if (!relativePath.startsWith(INCLUDED_NODE_MODULE_PREFIX)) {
    const inTree = INCLUDED_TREES.some((tree) => relativePath.startsWith(tree));
    if (!inTree && !INCLUDED_ROOT_FILES.has(relativePath)) return false;
  }
  if (SKIPPED_FILE_MARKERS.some((marker) => name.includes(marker))) return false;
  return ANALYSIS_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * Select and order the project-relative paths to read. Deterministic sort keeps the
 * analyzer's file map (and therefore its revision) stable across snapshot orderings.
 */
export function selectAnalysisFiles(paths: readonly string[], root: string): AnalysisFileSelection {
  const selected = new Set<string>();
  for (const path of paths) {
    const relative = projectRelativePath(root, path);
    if (relative === null || !isAnalysisPath(relative)) continue;
    selected.add(relative);
  }
  const ordered = [...selected].sort((left, right) => left.localeCompare(right));
  if (ordered.length > ANALYSIS_MAX_FILES) {
    return {
      ok: false,
      error:
        "project is too large to analyze: " +
        ordered.length +
        " source files (limit " +
        ANALYSIS_MAX_FILES +
        ")",
    };
  }
  return { ok: true, paths: ordered };
}

/** Null when the accumulated source fits the browser budget, else a user-facing reason. */
export function analysisSizeError(totalChars: number): string | null {
  if (totalChars <= ANALYSIS_MAX_TOTAL_CHARS) return null;
  return (
    "project is too large to analyze: " +
    totalChars +
    " characters of source (limit " +
    ANALYSIS_MAX_TOTAL_CHARS +
    ")"
  );
}
