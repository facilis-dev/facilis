/**
 * Node filesystem loader for the analyzer (exported as `@facilis.dev/analyze/fs`).
 *
 * Kept apart from the `./node` parser adapter: a Vite config that runs in the browser VM
 * needs to read a project directory but must not load a native/wasm parser. The loader only
 * reads and filters the file map; the caller injects the parser (D-092).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];
// Build output and VCS/IDE state are never DSL facts. .vite-cache is Vite's optimizer
// output when a project sets cacheDir (the template does): megabytes of bundled JS with
// nothing for the analyzer to read — yet more than half the bytes of a full project walk.
const ALWAYS_SKIPPED = new Set([
  ".git",
  "dist",
  "coverage",
  ".turbo",
  ".facilis",
  ".output",
  ".vite-cache",
]);

export interface LoadProjectOptions {
  /** Package scopes allowed under node_modules (default: @facilis.dev). */
  readonly nodeModuleScopes?: readonly string[];
}

/** Read a project directory into the analyzer's path -> source map. */
export function loadProjectFiles(
  root: string,
  options: LoadProjectOptions = {},
): Map<string, string> {
  const scopes = options.nodeModuleScopes ?? ["@facilis.dev"];
  const files = new Map<string, string>();
  const walk = (directory: string, relativeDirectory: string, framework = false): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // A framework install ships built code: a vendored (D-196) or registry package has
      // no src/, so its dist/ is the source the static passes read (D-199) — unlike the
      // project's own build output, which stays skipped.
      if (ALWAYS_SKIPPED.has(entry.name) && !(framework && entry.name === "dist")) continue;
      const full = join(directory, entry.name);
      const path =
        relativeDirectory.length === 0 ? entry.name : relativeDirectory + "/" + entry.name;
      const stat = entry.isSymbolicLink() ? statSync(full) : null;
      const isDirectory = stat === null ? entry.isDirectory() : stat.isDirectory();
      const isFile = stat === null ? entry.isFile() : stat.isFile();
      if (isDirectory) {
        if (entry.name === "node_modules") {
          for (const scope of scopes) {
            const scopeDirectory = join(full, scope);
            try {
              readdirSync(scopeDirectory);
            } catch {
              continue;
            }
            walk(scopeDirectory, path + "/" + scope, true);
          }
          continue;
        }
        walk(full, path, framework);
        continue;
      }
      if (!isFile) continue;
      if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
      files.set(path.split(sep).join("/"), readFileSync(full, "utf8"));
    }
  };
  walk(root, "");
  return files;
}
