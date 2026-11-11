/**
 * Jobs gate (D-157 applied to jobs): a handwritten job must be a `defineJob()` default export
 * whose `dbTables` is statically declared, and (D-157) every relation its `run` body reaches
 * through the system-scoped db client must be declared there. `pnpm test` (and therefore CI)
 * fails here, like `routes-gate.test.ts` does for routes; the runtime guard is the other half.
 *
 * The gate runs the real analyzer instead of matching source text, so it agrees with the IDE
 * and the AI validator on what "valid" means. Package helper calls stay opaque (the runtime
 * guard is the authority), never a false error.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadProjectFiles } from "./fs.ts";
import { createModuleGraph } from "./module-graph.ts";
import { createOxcParser } from "./node.ts";
import { emptyConfigFacts } from "./passes/config.ts";
import { buildJobRelationFacts } from "./passes/job-relations.ts";
import { buildJobFacts } from "./passes/jobs.ts";
import { buildSchemaFacts } from "./passes/schema.ts";
import { buildViewFacts } from "./passes/views.ts";
import type { Parser } from "./parser.ts";
import type { Diagnostic } from "./types.ts";

/** Directory the analyzer lists as jobs; keep in sync with passes/jobs.ts. */
const JOBS_DIR = "server/jobs/";

/** D-157 error codes: the gate fails on any of these (the unused warning does not block). */
const JOB_ERROR_CODES = new Set(["job-table-undeclared", "job-table-unresolved", "job-raw-sql"]);

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

function reasonFor(diagnostics: readonly Diagnostic[], code: string, file: string): string {
  return (
    diagnostics.find((item) => item.code === code && item.source?.file === file)?.message ?? ""
  );
}

interface AppScan {
  readonly jobFiles: number;
  readonly violations: readonly string[];
}

/** Run the analyzer over one app and report every job that breaks the applied declaration. */
function scanApp(appRoot: string, label: string, parser: Parser): AppScan {
  const graph = createModuleGraph({ files: loadProjectFiles(appRoot), parser });
  const jobs = buildJobFacts(graph);
  const schema = buildSchemaFacts(graph, emptyConfigFacts());
  const views = buildViewFacts(graph);
  const relations = buildJobRelationFacts(graph, jobs.jobs, schema.tables, views.views);
  const bySourceFile = new Map(jobs.jobs.map((job) => [job.sourceFile, job]));
  const violations: string[] = [];
  let jobFiles = 0;
  for (const path of graph.files.keys()) {
    if (!path.startsWith(JOBS_DIR) || path.endsWith(".test.ts")) continue;
    jobFiles += 1;
    const where = label + "/" + path;
    const job = bySourceFile.get(path);
    if (job === undefined) {
      const reason = reasonFor(jobs.diagnostics, "job-definition", path);
      violations.push(where + ": no job fact; " + reason);
      continue;
    }
    if (job.dbTables === null) {
      const reason = reasonFor(jobs.diagnostics, "job-definition-static", path);
      violations.push(where + ": dbTables is not statically declared; " + reason);
    }
  }
  for (const diagnostic of relations.diagnostics) {
    if (!JOB_ERROR_CODES.has(diagnostic.code)) continue;
    const file = diagnostic.source?.file ?? "unknown";
    violations.push(label + "/" + file + ": " + diagnostic.code + ": " + diagnostic.message);
  }
  return { jobFiles, violations };
}

function writeSource(root: string, path: string, source: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, source);
}

const CORE = 'import { defineJob } from "@facilis.dev/core";\n';
const FIXTURE_SCHEMA =
  'import { pgTable, uuid } from "drizzle-orm/pg-core";\n' +
  'export const todos = pgTable("todos", { id: uuid("id").primaryKey() });\n' +
  'export const notes = pgTable("notes", { id: uuid("id").primaryKey() });\n';
const IMPORT_RELATIONS = 'import { todos, notes } from "~/db/schema";\n';

describe("jobs gate", () => {
  it("passes on every job shipped in examples/todo-app", () => {
    const app = join(REPO_ROOT, "examples", "todo-app");
    expect(existsSync(join(app, JOBS_DIR)), "examples/todo-app has no server/jobs directory").toBe(
      true,
    );
    const scan = scanApp(app, "examples/todo-app", createOxcParser());
    expect(scan.jobFiles, "the gate found no job files").toBeGreaterThan(0);
    expect(
      scan.violations,
      "handwritten jobs violate the applied dbTables declaration:\n" + scan.violations.join("\n"),
    ).toEqual([]);
  });

  it("flags deliberately broken job definitions", () => {
    const fixture = mkdtempSync(join(tmpdir(), "facilis-jobs-gate-"));
    try {
      writeSource(fixture, "db/schema.ts", FIXTURE_SCHEMA);
      writeSource(fixture, "server/jobs/hand-rolled.ts", "export default async () => null;\n");
      writeSource(
        fixture,
        "server/jobs/no-tables.ts",
        CORE +
          IMPORT_RELATIONS +
          'export default defineJob({ name: "no-tables", run: async ({ db }) => db.delete(todos) });\n',
      );
      writeSource(
        fixture,
        "server/jobs/dynamic-tables.ts",
        CORE +
          IMPORT_RELATIONS +
          'export default defineJob({ name: "dynamic-tables", dbTables: loadTables(), run: async () => null });\n' +
          "function loadTables(): string[] { return []; }\n",
      );
      writeSource(
        fixture,
        "server/jobs/undeclared.ts",
        CORE +
          IMPORT_RELATIONS +
          'export default defineJob({ name: "undeclared", dbTables: ["todos"], run: async ({ db }) => db.delete(notes) });\n',
      );
      writeSource(
        fixture,
        "server/jobs/raw.ts",
        CORE +
          'export default defineJob({ name: "raw", dbTables: [], run: async ({ db }) => db.execute("select 1") });\n',
      );
      writeSource(
        fixture,
        "server/jobs/dynamic-relation.ts",
        CORE +
          'export default defineJob({ name: "dynamic-relation", dbTables: [], run: async ({ db }) => db.select().from(loadTable()) });\n' +
          "function loadTable(): unknown { return null; }\n",
      );
      writeSource(
        fixture,
        "server/jobs/good.ts",
        CORE +
          IMPORT_RELATIONS +
          'export default defineJob({ name: "good", dbTables: ["todos"], run: async ({ db }) => db.delete(todos) });\n',
      );
      const scan = scanApp(fixture, "fixture", createOxcParser());
      const report = scan.violations.join("\n");
      expect(scan.jobFiles).toBe(7);
      expect(report).toMatch(/hand-rolled\.ts: no job fact;/);
      expect(report).toContain("no-tables.ts: dbTables is not statically declared");
      expect(report).toContain("dynamic-tables.ts: dbTables is not statically declared");
      expect(report).toContain("undeclared.ts: job-table-undeclared");
      expect(report).toContain("raw.ts: job-raw-sql");
      expect(report).toContain("dynamic-relation.ts: job-table-unresolved");
      expect(report).not.toContain("good.ts");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
