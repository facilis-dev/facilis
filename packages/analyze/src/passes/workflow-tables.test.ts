import { describe, expect, it } from "vitest";

import type { JobFact } from "../types-jobs.ts";
import type { SourceRef, WorkflowFact, WorkflowStepFact } from "../types.ts";
import { buildWorkflowTableFacts } from "./workflow-tables.ts";

const WORKFLOW_FILE = "server/workflows/tasks.ts";

function ref(file: string): SourceRef {
  return { file, line: 1 };
}

function job(name: string, dbTables: readonly string[] | null): JobFact {
  return {
    name,
    sourceFile: "server/jobs/" + name + ".ts",
    source: ref("server/jobs/" + name + ".ts"),
    dbTables,
    rawSql: false,
    unknown: [],
  };
}

function step(index: number, kind: "job" | "approval", name: string | null): WorkflowStepFact {
  return { index, kind, name, permission: null, onRejectStep: null, source: ref(WORKFLOW_FILE) };
}

function workflow(name: string, steps: readonly WorkflowStepFact[]): WorkflowFact {
  return { name, sourceFile: WORKFLOW_FILE, source: ref(WORKFLOW_FILE), steps, unknown: [] };
}

const JOBS = [job("purge", ["notes", "todos"]), job("notify", ["notes", "users"])];

describe("buildWorkflowTableFacts", () => {
  it("unions the referenced jobs' tables, deduplicated and sorted", () => {
    const { facts, diagnostics } = buildWorkflowTableFacts(
      [
        workflow("purge-todos", [
          step(0, "job", "purge"),
          step(1, "approval", "purge.approval"),
          step(2, "job", "notify"),
        ]),
      ],
      JOBS,
    );
    expect(diagnostics).toEqual([]);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      name: "purge-todos",
      sourceFile: WORKFLOW_FILE,
      tables: ["notes", "todos", "users"],
      unknownJobs: [],
      unknown: false,
    });
  });

  it("derives nothing from approval steps alone", () => {
    const { facts, diagnostics } = buildWorkflowTableFacts(
      [workflow("approvals-only", [step(0, "approval", "a.key"), step(1, "approval", "b.key")])],
      JOBS,
    );
    expect(diagnostics).toEqual([]);
    expect(facts[0]?.tables).toEqual([]);
    expect(facts[0]?.unknown).toBe(false);
  });

  it("warns about a referenced job with no definition and keeps it visible", () => {
    const { facts, diagnostics } = buildWorkflowTableFacts(
      [workflow("purge-todos", [step(0, "job", "ghost"), step(1, "job", "purge")])],
      JOBS,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "workflow-job-unknown",
      severity: "warning",
      source: { file: WORKFLOW_FILE },
    });
    expect(diagnostics[0]?.message).toContain('"ghost"');
    expect(facts[0]?.unknownJobs).toEqual(["ghost"]);
    expect(facts[0]?.tables).toEqual(["notes", "todos"]);
    expect(facts[0]?.unknown).toBe(false);
  });

  it("warns once per missing job even when several steps reference it", () => {
    const { diagnostics } = buildWorkflowTableFacts(
      [workflow("twice", [step(0, "job", "ghost"), step(1, "job", "ghost")])],
      JOBS,
    );
    expect(diagnostics.map((entry) => entry.code)).toEqual(["workflow-job-unknown"]);
  });

  it("marks the surface unknown when a referenced job's dbTables is unreadable", () => {
    const { facts, diagnostics } = buildWorkflowTableFacts(
      [workflow("purge-todos", [step(0, "job", "ambiguous")])],
      [job("ambiguous", null)],
    );
    expect(diagnostics).toEqual([]);
    expect(facts[0]?.tables).toEqual([]);
    expect(facts[0]?.unknown).toBe(true);
  });

  it("marks the surface unknown when a job step name cannot be read", () => {
    const { facts } = buildWorkflowTableFacts(
      [workflow("unreadable", [step(0, "job", null)])],
      JOBS,
    );
    expect(facts[0]?.tables).toEqual([]);
    expect(facts[0]?.unknown).toBe(true);
  });

  it("returns one fact per workflow with derived tables independent of the others", () => {
    const { facts } = buildWorkflowTableFacts(
      [
        workflow("first", [step(0, "job", "purge")]),
        workflow("second", [step(0, "job", "notify")]),
      ],
      JOBS,
    );
    expect(facts.map((fact) => [fact.name, fact.tables])).toEqual([
      ["first", ["notes", "todos"]],
      ["second", ["notes", "users"]],
    ]);
  });
});
