import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the analyzer test fixture project. */
export const FIXTURE_PROJECT_ROOT = fileURLToPath(new URL("./project/", import.meta.url));

/** Read the fixture project into the analyzer's path -> source map. */
export function loadFixtureProject(root = FIXTURE_PROJECT_ROOT): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const path = relative(root, full).split(sep).join("/");
      files.set(path, readFileSync(full, "utf8"));
    }
  };
  walk(root);
  return files;
}
