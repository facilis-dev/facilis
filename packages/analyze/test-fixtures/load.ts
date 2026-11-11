import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the analyzer test fixture project. */
export const FIXTURE_PROJECT_ROOT = fileURLToPath(new URL("./project/", import.meta.url));

// The installed framework sources (a fake package tree) live outside `project/node_modules` on
// purpose: that directory name is gitignored, and a fresh checkout must still run these tests.
// They are overlaid on the project map under `node_modules/`, so the analyzer sees exactly the
// paths a generated project installs.
const FIXTURE_MODULES_ROOT = fileURLToPath(new URL("./framework/", import.meta.url));

function walk(root: string, directory: string, prefix: string, files: Map<string, string>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, prefix, files);
      continue;
    }
    files.set(prefix + relative(root, full).split(sep).join("/"), readFileSync(full, "utf8"));
  }
}

/** Read the fixture project and its installed framework sources into the analyzer path -> source map. */
export function loadFixtureProject(root = FIXTURE_PROJECT_ROOT): Map<string, string> {
  const files = new Map<string, string>();
  walk(root, root, "", files);
  walk(FIXTURE_MODULES_ROOT, FIXTURE_MODULES_ROOT, "node_modules/", files);
  return files;
}
