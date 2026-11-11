import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import type { Diagnostic } from "../types.ts";
import { buildJobFacts } from "./jobs.ts";

const parser = createOxcParser();
const CORE = 'import { defineJob } from "@facilis.dev/core";\n';

function scan(files: Record<string, string>) {
  const graph = createModuleGraph({ files: new Map(Object.entries(files)), parser });
  return buildJobFacts(graph);
}

function codes(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((entry) => entry.code).toSorted();
}

describe("buildJobFacts", () => {
  it("reads name, dbTables and rawSql from the defineJob call", () => {
    const source =
      CORE +
      "export default defineJob({\n" +
      '  name: "purge",\n' +
      '  dbTables: ["todos", "active_todos"],\n' +
      "  rawSql: true,\n" +
      '  run: async ({ db }) => db.execute("select 1"),\n' +
      "});\n";
    const { jobs, diagnostics } = scan({ "server/jobs/purge.ts": source });
    expect(diagnostics).toEqual([]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: "purge",
      sourceFile: "server/jobs/purge.ts",
      dbTables: ["todos", "active_todos"],
      rawSql: true,
      unknown: [],
    });
    expect(jobs[0]?.source.line).toBe(2);
  });

  it("defaults rawSql to false and accepts an explicitly empty dbTables", () => {
    const { jobs, diagnostics } = scan({
      "server/jobs/cleanup.ts":
        CORE + 'export default defineJob({ name: "cleanup", dbTables: [] });\n',
    });
    expect(diagnostics).toEqual([]);
    expect(jobs[0]?.rawSql).toBe(false);
    expect(jobs[0]?.dbTables).toEqual([]);
  });

  it("reads dbTables through a same-file const", () => {
    const source =
      CORE +
      'const TABLES = ["todos"];\n' +
      'export default defineJob({ name: "purge", dbTables: TABLES });\n';
    const { jobs, diagnostics } = scan({ "server/jobs/purge.ts": source });
    expect(diagnostics).toEqual([]);
    expect(jobs[0]?.dbTables).toEqual(["todos"]);
  });

  it("keeps an unreadable dbTables explicit and warns", () => {
    const source =
      CORE +
      'export default defineJob({ name: "purge", dbTables: loadTables() });\n' +
      "function loadTables(): string[] { return []; }\n";
    const { jobs, diagnostics } = scan({ "server/jobs/purge.ts": source });
    expect(jobs[0]?.dbTables).toBeNull();
    expect(codes(diagnostics)).toEqual(["job-definition-static"]);
    expect(diagnostics[0]?.severity).toBe("warning");
  });

  it("keeps an unreadable rawSql explicit so db.execute fails closed", () => {
    const source =
      CORE +
      'export default defineJob({ name: "purge", dbTables: [], rawSql: flag() });\n' +
      "function flag(): boolean { return true; }\n";
    const { jobs, diagnostics } = scan({ "server/jobs/purge.ts": source });
    expect(jobs[0]?.rawSql).toBeNull();
    expect(codes(diagnostics)).toEqual(["job-definition-static"]);
  });

  it("warns about a missing dbTables instead of guessing none", () => {
    const { jobs, diagnostics } = scan({
      "server/jobs/purge.ts": CORE + 'export default defineJob({ name: "purge" });\n',
    });
    expect(jobs[0]?.dbTables).toBeNull();
    expect(codes(diagnostics)).toEqual(["job-definition-static"]);
  });

  it("warns, never errors, when the file is not a job definition", () => {
    const { jobs, diagnostics } = scan({
      "server/jobs/hand-rolled.ts": "export default async () => null;\n",
      "server/jobs/not-core.ts":
        'import { defineJob } from "./local";\nexport default defineJob({ name: "x" });\n',
    });
    expect(jobs).toEqual([]);
    expect(codes(diagnostics)).toEqual(["job-definition", "job-definition"]);
    expect(diagnostics.every((entry) => entry.severity === "warning")).toBe(true);
  });

  it("skips test files and files outside server/jobs", () => {
    const valid = CORE + 'export default defineJob({ name: "purge", dbTables: [] });\n';
    const { jobs } = scan({
      "server/jobs/purge.ts": valid,
      "server/jobs/nested/deep.ts": valid,
      "server/jobs/purge.test.ts": valid,
      "server/tasks/purge.ts": valid,
    });
    expect(jobs.map((job) => job.sourceFile)).toEqual([
      "server/jobs/nested/deep.ts",
      "server/jobs/purge.ts",
    ]);
  });
});
