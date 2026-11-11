/**
 * SEC-12 gate: a handwritten route must satisfy security invariants 1-2 — its default export
 * is the `@facilis/core` `defineAuthorizedHandler` call, and its config carries a statically
 * readable `dbTables` array. The AI validator already blocks patches that miss this
 * (packages/ai/src/rules/routes-security.ts); handwritten code had no enforcement, so
 * `pnpm test` (and therefore CI) now fails here.
 *
 * The gate runs the real analyzer instead of matching source text, so it agrees with the IDE
 * and the AI validator on what "valid" means. Only project sources are loaded: framework
 * packages under node_modules cannot change invariants 1-2, and walking the example's
 * node_modules would tie the gate to a build.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadProjectFiles } from "./fs.ts";
import { createModuleGraph } from "./module-graph.ts";
import { createOxcParser } from "./node.ts";
import { buildConfigFacts } from "./passes/config.ts";
import { buildRouteFacts } from "./passes/routes.ts";
import type { Parser } from "./parser.ts";
import type { Diagnostic } from "./types.ts";

/** Directories the analyzer lists as routes; keep in sync with passes/routes.ts. */
const ROUTE_DIRS = ["server/routes/", "server/api/"] as const;

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

function hasServerRoutes(directory: string): boolean {
  return ROUTE_DIRS.some((routeDir) => existsSync(join(directory, routeDir)));
}

/** `examples/` holds one directory per app; `starter/` may be a template root itself. */
function appsWithRoutes(directory: string): string[] {
  if (!existsSync(directory)) return [];
  if (hasServerRoutes(directory)) return [directory];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name))
    .filter(hasServerRoutes);
}

function reasonFor(diagnostics: readonly Diagnostic[], code: string, file: string): string {
  return (
    diagnostics.find((item) => item.code === code && item.source?.file === file)?.message ?? ""
  );
}

interface AppScan {
  readonly routeFiles: number;
  readonly violations: readonly string[];
}

/** Run the analyzer over one app and report every route that breaks invariant 1 or 2. */
function scanApp(appRoot: string, label: string, parser: Parser): AppScan {
  const graph = createModuleGraph({
    files: loadProjectFiles(appRoot, { nodeModuleScopes: [] }),
    parser,
  });
  const routeFacts = buildRouteFacts(graph, buildConfigFacts(graph).facts);
  const bySourceFile = new Map(routeFacts.routes.map((route) => [route.sourceFile, route]));
  const violations: string[] = [];
  let routeFiles = 0;
  for (const path of graph.files.keys()) {
    if (!ROUTE_DIRS.some((routeDir) => path.startsWith(routeDir))) continue;
    routeFiles += 1;
    const where = label + "/" + path;
    const route = bySourceFile.get(path);
    if (route === undefined) {
      violations.push(where + ": no route fact; the filename is not a Nitro route location");
      continue;
    }
    if (route.wrapper !== "valid") {
      const reason = reasonFor(routeFacts.diagnostics, "route-wrapper", path);
      violations.push(where + ': wrapper is "' + route.wrapper + '"; ' + reason);
      continue;
    }
    if (route.dbTables === null) {
      const reason =
        reasonFor(routeFacts.diagnostics, "db-tables-present", path) ||
        reasonFor(routeFacts.diagnostics, "route-config-static", path);
      violations.push(where + ": dbTables is not statically declared; " + reason);
    }
  }
  return { routeFiles, violations };
}

function writeSource(root: string, path: string, source: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, source);
}

describe("SEC-12 route gate", () => {
  it("passes on every handwritten route shipped in examples/ and starter/", () => {
    const apps = ["examples", "starter"].flatMap((group) => appsWithRoutes(join(REPO_ROOT, group)));
    expect(apps.length, "no app with server routes under examples/ or starter/").toBeGreaterThan(0);
    const parser = createOxcParser();
    const scans = apps.map((app) => scanApp(app, relative(REPO_ROOT, app), parser));
    const routeFiles = scans.reduce((total, scan) => total + scan.routeFiles, 0);
    const violations = scans.flatMap((scan) => scan.violations);
    expect(routeFiles, "the gate found no route files").toBeGreaterThan(0);
    expect(
      violations,
      "handwritten routes violate invariants 1-2:\n" + violations.join("\n"),
    ).toEqual([]);
  });

  it("flags deliberately broken handwritten routes", () => {
    const fixture = mkdtempSync(join(tmpdir(), "facilis-route-gate-"));
    try {
      writeSource(
        fixture,
        "server/routes/hand-rolled.get.ts",
        "export default async () => null;\n",
      );
      writeSource(
        fixture,
        "server/routes/no-tables.get.ts",
        'import { defineAuthorizedHandler } from "@facilis/core";\n' +
          "export default defineAuthorizedHandler({ permission: [] }, async () => null);\n",
      );
      writeSource(
        fixture,
        "server/routes/dynamic-tables.get.ts",
        'import { defineAuthorizedHandler } from "@facilis/core";\n' +
          "export default defineAuthorizedHandler({ permission: [], dbTables: loadTables() }, async () => null);\n",
      );
      const scan = scanApp(fixture, "fixture", createOxcParser());
      const report = scan.violations.join("\n");
      expect(scan.routeFiles).toBe(3);
      expect(report).toMatch(/hand-rolled\.get\.ts: wrapper is "invalid"/);
      expect(report).toContain(
        "no-tables.get.ts: dbTables is not statically declared; dbTables is missing",
      );
      expect(report).toContain("dynamic-tables.get.ts: dbTables is not statically declared");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
