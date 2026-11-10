// The IDE's generated project IS examples/todo-app (D-062): one source of truth for the
// starter app's client, server, schema and i18n catalogues. The example is inlined as raw
// text at IDE build time (Vite import.meta.glob), so editing the example changes what
// "New project" scaffolds, and a drift test fails if a file the template needs is missing.
//
// Only the IDE-specific wrappers are written in this package: package.json (workspace
// specs become vendored tarballs), tsconfig (extends the repo base), npm hooks, the
// liveness ping route and the HMR hint (see template-overrides.ts).

const EXAMPLE_DIR = "examples/todo-app/";
const EXAMPLE_PATH = new RegExp(EXAMPLE_DIR.replace(/\//g, "\\/"));

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

/** Project-relative path of a glob key, or null when it is not an example file. */
function projectPath(key: string): string | null {
  const at = key.search(EXAMPLE_PATH);
  return at === -1 ? null : key.slice(at + EXAMPLE_DIR.length);
}

/** Every file the template takes from the example, keyed by its path in the project. */
export function exampleProjectFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [key, source] of Object.entries(rawSources)) {
    const path = projectPath(key);
    // package.json is rebuilt for npm + vendor tarballs; tsconfig is standalone and
    // not part of the glob at all (the example's extends the repo base).
    if (path !== null && path !== "package.json") files[path] = source;
  }
  return files;
}

/** The example's package.json source, the version source for the generated one. */
export function examplePackageJson(): string {
  for (const [key, source] of Object.entries(rawSources)) {
    if (projectPath(key) === "package.json") return source;
  }
  throw new Error("template: examples/todo-app/package.json not found");
}
