/**
 * D-224 gate: the shipped examples and the IDE starter template satisfy the framework's
 * `runtimeRequirements`.
 *
 * The template is not a separate app: the IDE inlines `examples/starter-app` and `addVmNitro`
 * changes only the release ref and the VM's Nitro runner, never a runtime/public declaration.
 * The last test asserts that provenance, so the gate cannot silently drift to another config.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { analyzeProject } from "./analyze.ts";
import { loadProjectFiles } from "./fs.ts";
import { createOxcParser } from "./node.ts";

const PARSER = createOxcParser();

/** Walk up from this file so the gate does not depend on the process cwd. */
function repositoryRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot locate the repo root from " + import.meta.url);
    current = parent;
  }
}

const REPO_ROOT = repositoryRoot();

/** Any runtime-key diagnostic, warning included: an example is the reference, not a lesson in noise. */
function runtimeDiagnostics(files: ReadonlyMap<string, string>) {
  return analyzeProject({ files, parser: PARSER }).diagnostics.filter((entry) =>
    entry.code.startsWith("runtime-key-"),
  );
}

/** Mirror of ide/src/facilis/template-overrides.ts addVmNitro: anchored, throws on drift. */
function addVmNitro(config: string): string {
  expect(config).toContain('release: { ref: "origin/main" }');
  const withRef = config.replace('release: { ref: "origin/main" }', 'release: { ref: "main" }');
  expect(withRef).toMatch(/\n\}\);\s*$/);
  return withRef.replace(
    /\n\}\);\s*$/,
    '\n  nitro: { devServer: { runner: "self" } },\n});\n',
  );
}

describe("runtime requirements gate (D-224)", () => {
  for (const name of ["starter-app", "todo-app"]) {
    it("declares every required runtime key in examples/" + name, () => {
      const diagnostics = runtimeDiagnostics(loadProjectFiles(join(REPO_ROOT, "examples", name)));
      expect(diagnostics.map((entry) => entry.message)).toEqual([]);
    });
  }

  it("declares every required runtime key in the IDE starter template config", () => {
    const files = new Map(loadProjectFiles(join(REPO_ROOT, "examples", "starter-app")));
    const config = files.get("facilis.config.ts");
    if (config === undefined) throw new Error("examples/starter-app has no facilis.config.ts");
    files.set("facilis.config.ts", addVmNitro(config));
    expect(runtimeDiagnostics(files).map((entry) => entry.message)).toEqual([]);
  });

  it("keeps the IDE template config derived from examples/starter-app", () => {
    const source = readFileSync(
      join(REPO_ROOT, "ide", "src", "facilis", "starter-template.ts"),
      "utf8",
    );
    expect(source).toContain('const EXAMPLE_DIR = "examples/starter-app/"');
    expect(source).toContain("addVmNitro(config, EXAMPLE_DIR)");
  });
});
