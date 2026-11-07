import { describe, expect, it } from "vitest";
import type { ValidationError } from "@facilis/ai";
import type { AiParseFailure } from "./response";
import {
  buildRepairMessages,
  formatFailure,
  formatFindings,
  formatFixPlan,
  MAX_REPAIR_ATTEMPTS,
  prioritizeFindings,
} from "./repair";

const FINDING: ValidationError = {
  rule: "permission-valid",
  severity: "error",
  file: "server/routes/api/todo.get.ts",
  message: 'Permission "todos:write" is not declared in facilis.config.ts.',
  fix_hint: "Declare it in auth.permissions (and roles) in the same patch.",
  line: 4,
  excerpt: "permission: [\"todos:write\"],",
};

const SCHEMA_FINDING: ValidationError = {
  rule: "destructive-confirmed",
  severity: "error",
  file: "db/schema.ts",
  message: "Destructive schema change without confirmation.",
  fix_hint: "Re-emit the schema keeping the table.",
};

const ROUTE_FINDING: ValidationError = {
  rule: "db-tables-valid",
  severity: "error",
  file: "server/routes/api/todos/index.get.ts",
  message: "The patch removes table todos.",
  fix_hint: "Keep the table.",
};

function failure(overrides: Partial<AiParseFailure> = {}): AiParseFailure {
  return {
    ok: false,
    kind: "validation",
    truncated: false,
    error: "The proposed patches failed validation.",
    issues: ["permission-valid: server/routes/api/todo.get.ts: ..."],
    findings: [FINDING],
    patchedFiles: [{ path: "db/schema.ts", action: "update", content: "old" }],
    raw: '{"message":"x","patches":[]}',
    ...overrides,
  };
}

describe("formatFindings", () => {
  it("turns each finding into what is wrong and what to change", () => {
    const text = formatFindings([FINDING]);
    expect(text).toContain("[permission-valid] server/routes/api/todo.get.ts:4");
    expect(text).toContain('Permission "todos:write" is not declared');
    expect(text).toContain("Fix: Declare it in auth.permissions");
    expect(text).toContain('At: permission: ["todos:write"],');
  });

  it("caps the list instead of echoing an unbounded set", () => {
    const many = Array.from({ length: 45 }, (_, index) => ({ ...FINDING, message: "m" + index }));
    const text = formatFindings(many);
    expect(text).toContain("(5 more findings omitted)");
    expect(text).not.toContain("[permission-valid] " + "m44");
  });
});

describe("formatFailure", () => {
  it("prefers the structured findings", () => {
    expect(formatFailure(failure())).toContain("Fix: Declare it in auth.permissions");
  });

  it("falls back to the structural issues when there are no findings", () => {
    const text = formatFailure(
      failure({ kind: "contract", findings: [], issues: ["message: must be a string"] }),
    );
    expect(text).toContain("The proposed patches failed validation.");
    expect(text).toContain("- message: must be a string");
  });

  it("leads with the cut-off explanation when the answer was truncated", () => {
    const text = formatFailure(
      failure({
        kind: "json",
        truncated: true,
        findings: [],
        issues: [],
        error: "Unexpected end of JSON input",
      }),
    );
    expect(text).toContain("cut the answer at its output limit");
    expect(text).toContain("Unexpected end of JSON input");
  });

  it("returns just the error when there is no detail", () => {
    expect(formatFailure(failure({ kind: "json", findings: [], issues: [] }))).toBe(
      "The proposed patches failed validation.",
    );
  });
});

describe("root-cause ordering", () => {
  it("puts schema and config findings before route consequences", () => {
    const ordered = prioritizeFindings([
      ROUTE_FINDING,
      SCHEMA_FINDING,
      { ...ROUTE_FINDING, file: "src/a.ts" },
    ]);
    expect(ordered[0]?.file).toBe("db/schema.ts");
    expect(ordered.at(-1)?.file).toBe("src/a.ts");
  });

  it("writes a per-file fix plan and names the files the answer touched", () => {
    const text = formatFixPlan([ROUTE_FINDING, SCHEMA_FINDING], [
      { path: "db/schema.ts", action: "update", content: "x" },
      { path: "server/routes/api/todos/index.get.ts", action: "create", content: "x" },
    ]);
    expect(text).toContain("## Fix plan (root cause first)");
    expect(text).toContain("- db/schema.ts — 1 finding(s): destructive-confirmed");
    expect(text).toContain("Fix db/schema.ts first");
    expect(text).toContain("## Your rejected answer touched");
    expect(text).toContain("- db/schema.ts (update)");
  });
});

describe("buildRepairMessages", () => {
  it("replays the rejected answer and requests a root-cause-first correction", async () => {
    const turns = await buildRepairMessages({
      failure: failure({ findings: [ROUTE_FINDING, SCHEMA_FINDING] }),
      attempt: 1,
      max: MAX_REPAIR_ATTEMPTS,
    });
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: "assistant", content: '{"message":"x","patches":[]}' });
    const request = turns[1]?.content ?? "";
    expect(turns[1]?.role).toBe("user");
    expect(request).toContain("correction 1 of " + MAX_REPAIR_ATTEMPTS);
    expect(request).toContain("## Fix plan (root cause first)");
    expect(request).toContain("## Validation findings");
    expect(request).toContain("## Tools");
    expect(request).toContain("read_file it first");
    expect(request).toContain("validate on the files you are about to return");
    expect(request).toContain("## Response contract");
    expect(request.indexOf("## Fix plan")).toBeLessThan(request.indexOf("## Validation findings"));
  });

  it("omits the assistant turn when the provider returned no text", async () => {
    const turns = await buildRepairMessages({
      failure: failure({ kind: "empty", findings: [], issues: [], raw: "  " }),
      attempt: 1,
      max: MAX_REPAIR_ATTEMPTS,
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.role).toBe("user");
  });

  it("explains a cut-off answer and the part protocol", async () => {
    const turns = await buildRepairMessages({
      failure: failure({
        kind: "json",
        truncated: true,
        findings: [],
        issues: [],
        raw: '{"message":"x","patches":[',
      }),
      attempt: 1,
      max: MAX_REPAIR_ATTEMPTS,
    });
    const request = turns.at(-1)?.content ?? "";
    expect(request).toContain("## The answer was cut off");
    expect(request).toContain('"continue": true');
    expect(request).toContain("at most 2-3 files per answer");
  });

  it("caps a huge rejected answer instead of echoing it whole", async () => {
    const turns = await buildRepairMessages({
      failure: failure({ raw: "x".repeat(50_000) }),
      attempt: 2,
      max: MAX_REPAIR_ATTEMPTS,
    });
    const request = turns.at(-1)?.content ?? "";
    expect(turns[0]?.content).toContain("[truncated]");
    expect(request).toContain("correction 2 of " + MAX_REPAIR_ATTEMPTS);
  });
});
