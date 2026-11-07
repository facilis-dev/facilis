/**
 * Node filesystem loader for the analyzer (exported as `@facilis/analyze/fs`).
 *
 * Kept apart from the `./node` parser adapter: a Vite config that runs in the browser VM
 * needs to read a project directory but must not load a native/wasm parser. The loader only
 * reads and filters the file map; the caller injects the parser (D-092).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];
const ALWAYS_SKIPPED = new Set([".git", "dist", "coverage", ".turbo", ".facilis", ".output"]);

export interface LoadProjectOptions {
  /** Package scopes allowed under node_modules (default: @facilis). */
  readonly nodeModuleScopes?: readonly string[];
}

/** Read a project directory into the analyzer's path -> source map. */
export function loadProjectFiles(
  root: string,
  options: LoadProjectOptions = {},
): Map<string, string> {
  const scopes = options.nodeModuleScopes ?? ["@facilis"];
  const files = new Map<string, string>();
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ALWAYS_SKIPPED.has(entry.name)) continue;
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
            walk(scopeDirectory, path + "/" + scope);
          }
          continue;
        }
        walk(full, path);
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
