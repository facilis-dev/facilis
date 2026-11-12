// The IDE's full-stack generated project IS examples/todo-app (D-062): one source of
// truth for the starter app's client, server, schema and i18n catalogues. The example is
// inlined as raw text at IDE build time (Vite import.meta.glob), so editing the example
// changes what "New project" scaffolds, and a drift test fails if a file the template
// needs is missing.
//
// Only the IDE-specific wrappers are written in this package: package.json (workspace
// specs become exact published versions, D-166), tsconfig (extends the repo base), npm
// hooks, the liveness ping route and the HMR hint (see template-overrides.ts).

import { exampleSources } from "./example-sources";
import type { ExampleSources } from "./template-types";

const EXAMPLE_DIR = "examples/todo-app/";

const rawSources = import.meta.glob<string>(
  [
    "../../../examples/todo-app/src/**/*.{ts,tsx,css}",
    "!../../../examples/todo-app/src/**/*.test.*",
    "../../../examples/todo-app/server/**/*.ts",
    "../../../examples/todo-app/db/**/*",
    "!../../../examples/todo-app/db/**/*.test.*",
    "../../../examples/todo-app/locales/*.json",
    "../../../examples/todo-app/index.html",
    "../../../examples/todo-app/.gitignore",
    "../../../examples/todo-app/vite.config.ts",
    "../../../examples/todo-app/facilis.config.ts",
    "../../../examples/todo-app/package.json",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** The example's sources: every file, and the package.json the generated one is built from. */
export function todoExampleSources(): ExampleSources {
  return exampleSources(rawSources, EXAMPLE_DIR);
}

/** Every file the template takes from the example, keyed by its path in the project. */
export function exampleProjectFiles(): Record<string, string> {
  return todoExampleSources().files;
}

/** The example's package.json source, the version source for the generated one. */
export function examplePackageJson(): string {
  return todoExampleSources().packageJson;
}
