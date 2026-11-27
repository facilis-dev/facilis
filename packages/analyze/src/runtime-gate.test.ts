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

import { KNOWN_RUNTIME_KEYS } from "@facilis.dev/core";

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

/**
 * One analysis per example: the analyzer is the expensive part of this gate and the suite runs it
 * beside the other example-wide gates, so repeating it here pushed those past their timeout.
 */
const ANALYSES = new Map<string, ReturnType<typeof analyzeProject>>();

function analysisFor(name: string) {
  let analysis = ANALYSES.get(name);
  if (analysis === undefined) {
    analysis = analyzeProject({
      files: loadProjectFiles(join(REPO_ROOT, "examples", name)),
      parser: PARSER,
    });
    ANALYSES.set(name, analysis);
  }
  return analysis;
}

/** Mirror of ide/src/facilis/template-overrides.ts addVmNitro: anchored, throws on drift. */
function addVmNitro(config: string): string {
  expect(config).toContain('release: { ref: "origin/main" }');
  const withRef = config.replace('release: { ref: "origin/main" }', 'release: { ref: "main" }');
  expect(withRef).toMatch(/\n\}\);\s*$/);
  return withRef.replace(/\n\}\);\s*$/, '\n  nitro: { devServer: { runner: "self" } },\n});\n');
}

describe("runtime requirements gate (D-224)", () => {
  for (const name of ["starter-app", "todo-app"]) {
    it("declares every required runtime key in examples/" + name, () => {
      const diagnostics = analysisFor(name).diagnostics.filter((entry) =>
        entry.code.startsWith("runtime-key-"),
      );
      expect(diagnostics.map((entry) => entry.message)).toEqual([]);
    });

    it("declares the framework's whole surface in examples/" + name, () => {
      const facts = analysisFor(name).config.runtimeConfig;
      expect(facts.runtimeUnknown).toBe(false);
      expect(Object.keys(facts.runtime).toSorted()).toEqual([...KNOWN_RUNTIME_KEYS].toSorted());
    });
  }

  it("declares every required runtime key in the IDE starter template config", () => {
    // The template is the same app with a rewritten config, so only the config facts matter here:
    // analyzing the whole example again would duplicate the work the two tests above already did.
    const config = readFileSync(
      join(REPO_ROOT, "examples", "starter-app", "facilis.config.ts"),
      "utf8",
    );
    const template = analyzeProject({
      files: new Map([["facilis.config.ts", addVmNitro(config)]]),
      parser: PARSER,
    });
    const keys = Object.keys(template.config.runtimeConfig.runtime).toSorted();
    expect(keys).toEqual([...KNOWN_RUNTIME_KEYS].toSorted());
    expect(
      template.diagnostics
        .filter((entry) => entry.code.startsWith("runtime-key-"))
        .map((entry) => entry.message),
    ).toEqual([]);
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
