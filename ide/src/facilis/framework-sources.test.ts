import { describe, expect, it } from "vitest";
import { TEMPLATE_PACKAGES } from "./facilis-template";
import { FRAMEWORK_TABLE_PACKAGES, frameworkProjectFiles } from "./framework-sources";

// The IDE's app tsconfig is a browser program with no Node types, so a literal
// `import "node:fs"` would pull @types/node in and clash with the DOM/vendor typings
// (D-086). Load only the narrow surface the drift guard needs, through a non-literal
// specifier, exactly as release-git.test.ts does.
interface NodeFs {
  readdirSync(path: string, options: { recursive: true }): string[];
  readFileSync(path: string, encoding: "utf8"): string;
}
interface NodePath {
  join(...parts: string[]): string;
}
interface NodeUrl {
  fileURLToPath(url: URL): string;
}
const loadNode = (specifier: string): Promise<unknown> => import(specifier);
const { readdirSync, readFileSync } = (await loadNode("node:fs")) as NodeFs;
const { fileURLToPath } = (await loadNode("node:url")) as NodeUrl;
const { join } = (await loadNode("node:path")) as NodePath;

const files = frameworkProjectFiles();
const paths = [...files.keys()];

describe("framework project files", () => {
  it("maps only auth and db sources to their installed paths", () => {
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const installed =
        path.startsWith("node_modules/@facilis/auth/") ||
        path.startsWith("node_modules/@facilis/db/");
      expect(installed, path).toBe(true);
    }
  });

  it("skips test files and ships only non-empty sources", () => {
    expect(paths.some((path) => path.includes(".test.") || path.includes(".spec."))).toBe(false);
    for (const [path, source] of files) expect(source.length, path).toBeGreaterThan(0);
  });

  it("carries the manifests and the table modules the analyzer resolves through", () => {
    for (const packageName of FRAMEWORK_TABLE_PACKAGES) {
      const prefix = "node_modules/@facilis/" + packageName;
      // package.json is what resolvePackage() reads for the package's exports entry.
      expect(files.has(prefix + "/package.json"), packageName).toBe(true);
      expect(files.has(prefix + "/src/index.ts"), packageName).toBe(true);
    }
    expect(files.has("node_modules/@facilis/auth/src/tables.ts")).toBe(true);
    expect(files.has("node_modules/@facilis/db/src/files.ts")).toBe(true);
  });

  it("is deterministic and sorted", () => {
    expect([...frameworkProjectFiles().keys()]).toEqual(paths);
    expect(paths).toEqual(paths.toSorted((left, right) => left.localeCompare(right)));
  });
});

// Why this guard: framework tables reach the graph only because this module inlines their
// package. A future template package that starts declaring pgTable would silently vanish
// from the graph again unless it is listed here, so this test fails instead.
describe("framework table package drift", () => {
  const packagesRoot = fileURLToPath(new URL("../../../packages/", import.meta.url));
  const tableDeclaration = /pgTable\(\s*["'`]/;

  function declaresTable(packageName: string): boolean {
    const source = join(packagesRoot, packageName, "src");
    return readdirSync(source, { recursive: true })
      .filter((file) => file.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(file))
      .some((file) => tableDeclaration.test(readFileSync(join(source, file), "utf8")));
  }

  it("lists every template package that declares a pgTable", () => {
    const declaring = TEMPLATE_PACKAGES.filter(declaresTable);
    const missing = declaring.filter((name) => !FRAMEWORK_TABLE_PACKAGES.includes(name));
    expect(missing).toEqual([]);
  });

  it("only lists packages the template actually installs", () => {
    for (const name of FRAMEWORK_TABLE_PACKAGES) expect(TEMPLATE_PACKAGES).toContain(name);
  });
});
