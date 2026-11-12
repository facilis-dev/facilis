// Turning an eager `?raw` glob of one example directory into the file map a template
// ships. The glob itself stays in the template module, because Vite resolves its patterns
// relative to the importing file; this only strips the example prefix and separates
// package.json, which every template rebuilds instead of copying verbatim
// (template-files.ts).

import type { ExampleSources } from "./template-types";

/**
 * Files of one example, keyed by their project-relative path.
 *
 * `rawSources` is an eager `?raw` glob rooted at `exampleDir` (e.g. "examples/todo-app/");
 * a key may carry the repository path in front of it — the directory's position in the key
 * is what selects a file.
 */
export function exampleSources(
  rawSources: Record<string, string>,
  exampleDir: string,
): ExampleSources {
  const files: Record<string, string> = {};
  let packageJson: string | undefined;
  for (const [key, source] of Object.entries(rawSources)) {
    const at = key.lastIndexOf(exampleDir);
    if (at === -1) continue;
    const path = key.slice(at + exampleDir.length);
    if (path === "package.json") packageJson = source;
    else files[path] = source;
  }
  if (packageJson === undefined) {
    throw new Error("template: " + exampleDir + "package.json not found");
  }
  return { files, packageJson };
}
