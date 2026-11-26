/**
 * D-211 gate: every project table declares its access class (invariant 4, D-136) —
 * RLS-scoped (`.enableRLS()` plus a policy set) or explicitly system-only (the
 * `// system-only` marker). A plain `pgTable` without RLS gets no app-role privilege
 * (`ensureAppRole` grants by the catalog alone), so its routes fail closed at runtime;
 * the AI validator blocks such patches (rule 20), but handwritten schemas had no
 * enforcement, so `pnpm test` (and therefore CI) fails here.
 *
 * The gate runs the real analyzer instead of matching source text, so it agrees with the
 * IDE and the AI validator on what "declared" means. Framework tables re-exported from
 * `@facilis.dev/auth` / `@facilis.dev/db` ship their own class and are exempt: the class
 * pass only reads project `db/**` declarations.
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
import { buildSchemaFacts } from "./passes/schema.ts";
import type { Parser } from "./parser.ts";

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

function hasSchema(directory: string): boolean {
  return existsSync(join(directory, "db", "schema.ts"));
}

/** `examples/` holds one directory per app; `starter/` may be a template root itself. */
function appsWithSchemas(directory: string): string[] {
  if (!existsSync(directory)) return [];
  if (hasSchema(directory)) return [directory];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name))
    .filter(hasSchema);
}

interface SchemaScan {
  /** Tables the project declares itself (framework re-exports carry a node_modules source). */
  readonly projectTables: number;
  readonly violations: readonly string[];
  /** Class warnings: the shipped apps must boot with zero, like the route gate's unused set. */
  readonly warnings: readonly string[];
}

/** Run the analyzer over one app and report every project table with no declared class. */
function scanApp(appRoot: string, label: string, parser: Parser): SchemaScan {
  const graph = createModuleGraph({ files: loadProjectFiles(appRoot), parser });
  const config = buildConfigFacts(graph).facts;
  const schema = buildSchemaFacts(graph, config);
  const projectTables = schema.tables.filter((table) => table.source.file.startsWith("db/")).length;
  const violations: string[] = [];
  const warnings: string[] = [];
  for (const diagnostic of schema.diagnostics) {
    const where = label + "/" + (diagnostic.source?.file ?? "unknown");
    if (diagnostic.code === "table-class-declared" && diagnostic.severity === "error") {
      violations.push(where + ": " + diagnostic.message);
    } else if (
      diagnostic.code === "table-rls-no-policies" ||
      diagnostic.code === "schema-marker" ||
      diagnostic.code === "table-class-declared"
    ) {
      warnings.push(where + ": " + diagnostic.code + ": " + diagnostic.message);
    }
  }
  return { projectTables, violations, warnings };
}

function writeSource(root: string, path: string, source: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, source);
}

const IMPORTS =
  'import { pgTable, uuid } from "drizzle-orm/pg-core";\n' +
  'import { tenantColumn, tenantIsolationPolicy } from "@facilis.dev/db";\n';

const FIXTURE_SCHEMA =
  IMPORTS +
  "\n// system-only: audit trail, reached only through ctx.sudo\n" +
  'export const audit = pgTable("audit", { id: uuid("id").primaryKey() });\n' +
  '\nexport const plain = pgTable("plain", { id: uuid("id").primaryKey() });\n' +
  '\nexport const half = pgTable("half", { id: uuid("id").primaryKey() }, () => []).enableRLS();\n' +
  "\nexport const scoped = pgTable(\n" +
  '  "scoped",\n' +
  '  { id: uuid("id").primaryKey(), tenantId: tenantColumn() },\n' +
  "  () => [tenantIsolationPolicy()],\n" +
  ").enableRLS();\n" +
  "\n// system-only\n" +
  '\nexport const stray = pgTable("stray", { id: uuid("id").primaryKey() });\n';

describe("D-211 schema class gate", () => {
  it("passes on every schema shipped in examples/ and starter/", () => {
    const apps = ["examples", "starter"].flatMap((group) =>
      appsWithSchemas(join(REPO_ROOT, group)),
    );
    expect(apps.length, "no app with db/schema.ts under examples/ or starter/").toBeGreaterThan(0);
    const parser = createOxcParser();
    const scans = apps.map((app) => scanApp(app, relative(REPO_ROOT, app), parser));
    const projectTables = scans.reduce((total, scan) => total + scan.projectTables, 0);
    const violations = scans.flatMap((scan) => scan.violations);
    expect(projectTables, "the gate found no project tables").toBeGreaterThan(0);
    expect(
      violations,
      "project tables declare no access class (invariant 4):\n" + violations.join("\n"),
    ).toEqual([]);
  });

  it("ships no class warning in examples/ and starter/", () => {
    const apps = ["examples", "starter"].flatMap((group) =>
      appsWithSchemas(join(REPO_ROOT, group)),
    );
    const parser = createOxcParser();
    const warnings = apps.flatMap((app) => scanApp(app, relative(REPO_ROOT, app), parser).warnings);
    expect(warnings, "schema class warnings:\n" + warnings.join("\n")).toEqual([]);
  });

  it("exempts the framework-only starter schema (re-exports ship their own class)", () => {
    const app = join(REPO_ROOT, "examples", "starter-app");
    const scan = scanApp(app, "examples/starter-app", createOxcParser());
    expect(scan.projectTables).toBe(0);
    expect(scan.violations).toEqual([]);
    expect(scan.warnings).toEqual([]);
  });

  it("flags deliberately broken handwritten schemas", () => {
    const fixture = mkdtempSync(join(tmpdir(), "facilis-schema-gate-"));
    try {
      writeSource(fixture, "db/schema.ts", FIXTURE_SCHEMA);
      const scan = scanApp(fixture, "fixture", createOxcParser());
      expect(scan.projectTables).toBe(5);
      const report = scan.violations.join("\n");
      expect(report).toContain('db/schema.ts: table "plain" declares no access class');
      // The marker must sit on the line immediately above the declaration: a blank line
      // between them leaves the class undeclared.
      expect(report).toContain('db/schema.ts: table "stray" declares no access class');
      expect(report).not.toContain('"audit"');
      expect(report).not.toContain('"scoped"');
      expect(report).not.toContain('"half"');
      const warnings = scan.warnings.join("\n");
      expect(warnings).toContain("table-rls-no-policies");
      expect(warnings).toContain('table "half"');
      expect(warnings).not.toContain("table-class-declared");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("warns, never guesses an error, when the parser exposes no comments", () => {
    const fixture = mkdtempSync(join(tmpdir(), "facilis-schema-gate-"));
    try {
      writeSource(
        fixture,
        "db/schema.ts",
        IMPORTS + 'export const plain = pgTable("plain", { id: uuid("id").primaryKey() });\n',
      );
      const base = createOxcParser();
      const noComments: Parser = {
        parse(filename, source) {
          const parsed = base.parse(filename, source);
          return { program: parsed.program, errors: parsed.errors };
        },
      };
      const scan = scanApp(fixture, "fixture", noComments);
      expect(scan.violations).toEqual([]);
      const warnings = scan.warnings.join("\n");
      expect(warnings).toContain("schema-marker");
      expect(warnings).toContain("table-class-declared");
      expect(warnings).toContain("not provable");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
