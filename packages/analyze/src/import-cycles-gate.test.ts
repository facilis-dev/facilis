/**
 * D-217 gate: import-cycle detection over the shipped apps. A cycle warns (boot order and
 * bundling hurt, the app still runs), so this gate never fails on a warning; it proves the
 * detector on cyclic/acyclic fixtures, keeps the framework node_modules overlay out, and
 * asserts the shipped examples produce no import-cycle error.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { analyzeProject } from "./analyze.ts";
import { loadProjectFiles } from "./fs.ts";
import { createModuleGraph } from "./module-graph.ts";
import { createOxcParser } from "./node.ts";
import { buildFileFacts } from "./passes/file-facts.ts";
import { importCycleDiagnostics, IMPORT_CYCLE_CODE } from "./passes/import-cycle.ts";

const PARSER = createOxcParser();

/** Walk up from this file so the gate does not depend on the process cwd. */
function repositoryRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (readdirSync(current).includes("pnpm-workspace.yaml")) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot locate the repo root from " + import.meta.url);
    current = parent;
  }
}

const REPO_ROOT = repositoryRoot();

function fixtureDiagnostics(files: Record<string, string>) {
  const graph = createModuleGraph({ files: new Map(Object.entries(files)), parser: PARSER });
  return importCycleDiagnostics(graph, buildFileFacts(graph));
}

function shippedApps(): string[] {
  return readdirSync(join(REPO_ROOT, "examples"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(REPO_ROOT, "examples", entry.name))
    .toSorted((left, right) => left.localeCompare(right));
}

describe("import-cycle gate (D-217)", () => {
  it("warns on the cyclic fixture and names A -> B -> A", () => {
    const found = fixtureDiagnostics({
      "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
      "b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe(IMPORT_CYCLE_CODE);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain('"a.ts" -> "b.ts" -> "a.ts"');
  });

  it("stays silent on the acyclic fixture", () => {
    expect(
      fixtureDiagnostics({
        "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
        "b.ts": "export const b = 1;\n",
      }),
    ).toEqual([]);
  });

  it("ignores a framework package that re-exports itself", () => {
    expect(
      fixtureDiagnostics({
        "app.ts": 'import { auth } from "@facilis.dev/auth";\nexport const app = auth;\n',
        "node_modules/@facilis.dev/auth/package.json": JSON.stringify({
          exports: { ".": "./src/index.ts" },
        }),
        "node_modules/@facilis.dev/auth/src/index.ts": 'export * from "./state.ts";\n',
        "node_modules/@facilis.dev/auth/src/state.ts": 'export * from "./index.ts";\n',
      }),
    ).toEqual([]);
  });

  it("reports the shipped examples' cycles as warnings only", () => {
    const apps = shippedApps();
    expect(apps.length, "no app under examples/").toBeGreaterThan(0);
    const findings: string[] = [];
    const counts: string[] = [];
    for (const app of apps) {
      const analysis = analyzeProject({
        files: loadProjectFiles(app),
        parser: PARSER,
      });
      const cycles = analysis.diagnostics.filter((entry) => entry.code === IMPORT_CYCLE_CODE);
      counts.push(app.slice(REPO_ROOT.length + 1) + "=" + cycles.length);
      for (const cycle of cycles) {
        if (cycle.severity !== "warning") findings.push(app + ": " + cycle.severity);
      }
    }
    expect(findings, "import cycles must warn, never error").toEqual([]);
    // Visible in CI output so the number is reported instead of silently tolerated.
    console.info("[import-cycle] shipped examples: " + counts.join(", "));
  });
});
