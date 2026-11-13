import { describe, expect, it } from "vitest";

import {
  FRAMEWORK_MODULES,
  MAX_REFERENCE_ENTRIES,
  frameworkIndex,
  referenceFor,
} from "./framework-reference";

// The IDE's app tsconfig is a browser program with no Node types, so a literal
// `import "node:fs"` would pull @types/node in and clash with the DOM/vendor typings
// (D-086). Load only the narrow surface the drift guard needs, through a non-literal
// specifier, exactly as framework-sources.test.ts does.
interface NodeFs {
  readdirSync(path: string, options: { withFileTypes: true }): NodeDirent[];
  readFileSync(path: string, encoding: "utf8"): string;
}
interface NodeDirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}
interface NodePath {
  join(...parts: string[]): string;
  resolve(path: string): string;
}
interface NodeUrl {
  fileURLToPath(url: URL): string;
}
const loadNode = (specifier: string): Promise<unknown> => import(specifier);
const { readdirSync, readFileSync } = (await loadNode("node:fs")) as NodeFs;
const { join, resolve } = (await loadNode("node:path")) as NodePath;
const { fileURLToPath } = (await loadNode("node:url")) as NodeUrl;

// The packages/ directory of the repository this test ships in (ide/src/ai -> repo root).
const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const SCOPE = "@facilis.dev/";

interface PackageOnDisk {
  readonly dir: string;
  readonly name: string;
}

function packageDirs(): PackageOnDisk[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifest = JSON.parse(
        readFileSync(join(PACKAGES_DIR, entry.name, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (typeof manifest.name !== "string") {
        throw new Error(entry.name + "/package.json has no name");
      }
      return { dir: entry.name, name: manifest.name };
    })
    .filter((entry) => entry.name.startsWith(SCOPE));
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    // Test modules are exempt: a symbol only referenced by its own test is still drift.
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

function packageSource(pkg: PackageOnDisk): string {
  return sourceFiles(join(PACKAGES_DIR, pkg.dir, "src"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

/** A word match, so renaming `formatDate` cannot be masked by `formatDateTime` or a comment. */
function mentions(source: string, name: string): boolean {
  return new RegExp("\\b" + name + "\\b").test(source);
}

const ON_DISK = packageDirs();
const MODULE_BY_PACKAGE = new Map(FRAMEWORK_MODULES.map((module) => [module.package, module]));

describe("framework reference data vs the packages on disk", () => {
  it("has one module per installed @facilis.dev package and no module for a missing one", () => {
    const onDisk = ON_DISK.map((pkg) => pkg.name).toSorted();
    const referenced = FRAMEWORK_MODULES.map((module) => module.package).toSorted();
    expect(referenced).toEqual(onDisk);
  });

  it("gives every module a non-empty summary and unique id", () => {
    const ids = new Set<string>();
    for (const module of FRAMEWORK_MODULES) {
      expect(module.summary.trim().length).toBeGreaterThan(0);
      expect(ids.has(module.id)).toBe(false);
      ids.add(module.id);
    }
  });

  it("names only symbols that still exist in the package source", () => {
    for (const pkg of ON_DISK) {
      const module = MODULE_BY_PACKAGE.get(pkg.name);
      if (module === undefined) throw new Error("missing module for " + pkg.name);
      const source = packageSource(pkg);
      const missing = module.entries
        .filter((entry) => !mentions(source, entry.name))
        .map((entry) => entry.name);
      expect(missing, pkg.name + " entries absent from src").toEqual([]);
    }
  });

  it("keeps entry names unique inside each module", () => {
    for (const module of FRAMEWORK_MODULES) {
      const names = module.entries.map((entry) => entry.name);
      expect(new Set(names).size, module.id).toBe(names.length);
      expect(names.length, module.id).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("frameworkIndex", () => {
  it("lists every module id on its own line", () => {
    const index = frameworkIndex();
    const lines = index.split("\n");
    for (const module of FRAMEWORK_MODULES) {
      expect(lines.some((line) => line.startsWith("- " + module.id + " "))).toBe(true);
      expect(index).toContain(module.package);
    }
    expect(lines).toHaveLength(FRAMEWORK_MODULES.length + 1);
  });
});

describe("referenceFor", () => {
  it("filters by module id and by either package spelling, case-insensitively", () => {
    for (const needle of ["db", "DB", "@facilis.dev/db"]) {
      const result = referenceFor({ module: needle });
      expect(result.truncated).toBe(false);
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches.every((match) => match.module === "db")).toBe(true);
    }
  });

  it("returns an unknown module as empty data, not an error", () => {
    expect(referenceFor({ module: "does-not-exist" })).toEqual({ matches: [], truncated: false });
  });

  it("filters by a case-insensitive substring over name, signature and summary", () => {
    const result = referenceFor({ query: "formatDate" });
    expect(result.matches.length).toBeGreaterThanOrEqual(3);
    for (const match of result.matches) {
      const haystack = match.name + match.signature + match.summary;
      expect(haystack.toLowerCase()).toContain("formatdate");
    }
  });

  it("combines the module and query filters", () => {
    const result = referenceFor({ module: "time", query: "day" });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.every((match) => match.module === "time")).toBe(true);
  });

  it("caps a broad query and reports truncation", () => {
    const result = referenceFor({ query: "e" });
    expect(result.matches).toHaveLength(MAX_REFERENCE_ENTRIES);
    expect(result.truncated).toBe(true);
  });

  it("stamps each match with its module and package", () => {
    const [first] = referenceFor({ module: "core", query: "defineAuthorizedHandler" }).matches;
    expect(first).toMatchObject({ module: "core", package: "@facilis.dev/core" });
    expect(first?.example).toBeDefined();
  });
});
