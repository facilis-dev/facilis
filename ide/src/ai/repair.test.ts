import { describe, expect, it } from "vitest";
import type { ValidationError } from "@facilis/ai";
import type { AiParseFailure } from "./response";
import { buildRepairMessages, formatFailure, formatFindings, MAX_REPAIR_ATTEMPTS } from "./repair";

const FINDING: ValidationError = {
  rule: "permission-valid",
  severity: "error",
  file: "server/routes/api/todo.get.ts",
  message: 'Permission "todos:write" is not declared in facilis.config.ts.',
  fix_hint: "Declare it in auth.permissions (and roles) in the same patch.",
  line: 4,
  excerpt: "permission: [\"todos:write\"],",
};

const SCHEMA = "export const todos = pgTable(\"todos\", { id: text(\"id\") });\n";

function failure(overrides: Partial<AiParseFailure> = {}): AiParseFailure {
  return {
    ok: false,
    kind: "validation",
    error: "The proposed patches failed validation.",
    issues: ["permission-valid: server/routes/api/todo.get.ts: ..."],
    findings: [FINDING],
    patchedFiles: [{ path: "db/schema.ts", action: "update", content: "old" }],
    raw: '{"message":"x","patches":[]}',
    ...overrides,
  };
}

const read = async (path: string): Promise<string> => (path === "db/schema.ts" ? SCHEMA : "");

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
    const text = formatFailure(failure({ kind: "contract", findings: [], issues: ["message: must be a string"] }));
    expect(text).toContain("The proposed patches failed validation.");
    expect(text).toContain("- message: must be a string");
  });

  it("returns just the error when there is no detail", () => {
    expect(formatFailure(failure({ kind: "json", findings: [], issues: [] }))).toBe(
      "The proposed patches failed validation.",
    );
  });
});

describe("buildRepairMessages", () => {
  it("replays the rejected answer and requests a bounded correction", async () => {
    const turns = await buildRepairMessages({ failure: failure(), attempt: 1, max: MAX_REPAIR_ATTEMPTS, read });
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: "assistant", content: '{"message":"x","patches":[]}' });
    const request = turns[1]?.content ?? "";
    expect(turns[1]?.role).toBe("user");
    expect(request).toContain("correction 1 of 2");
    expect(request).toContain("## Validation findings");
    expect(request).toContain("Fix: Declare it in auth.permissions");
    expect(request).toContain("## Response contract");
    expect(request).toContain("complete file content");
    // A whole-file update cannot be repaired blind: the current file is included.
    expect(request).toContain("## Current content of the files your rejected answer tried to rewrite");
    expect(request).toContain("### db/schema.ts");
    expect(request).toContain(SCHEMA);
  });

  it("points at the tools instead of inlining files when the runtime is available", async () => {
    const turns = await buildRepairMessages({
      failure: failure(),
      attempt: 1,
      max: MAX_REPAIR_ATTEMPTS,
      read,
      toolsAvailable: true,
    });
    const request = turns.at(-1)?.content ?? "";
    expect(request).toContain("## Tools");
    expect(request).toContain("read_file/search");
    expect(request).toContain("validate");
    expect(request).not.toContain("## Current content of the files");
    expect(request).not.toContain(SCHEMA);
  });

  it("omits the assistant turn when the provider returned no text", async () => {
    const turns = await buildRepairMessages({
      failure: failure({ kind: "empty", findings: [], issues: [], raw: "  " }),
      attempt: 1,
      max: MAX_REPAIR_ATTEMPTS,
      read,
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.role).toBe("user");
  });

  it("caps a huge file instead of blowing the request budget", async () => {
    const turns = await buildRepairMessages({
      failure: failure(),
      attempt: 2,
      max: MAX_REPAIR_ATTEMPTS,
      read: async () => "x".repeat(50_000),
    });
    const request = turns.at(-1)?.content ?? "";
    expect(request).toContain("[truncated]");
    expect(request.length).toBeLessThan(40_000);
  });

  it("never reads a model-authored path outside the project root", async () => {
    const requested: string[] = [];
    const turns = await buildRepairMessages({
      failure: failure({ patchedFiles: [{ path: "../escape.ts", action: "update", content: "x" }] }),
      attempt: 1,
      max: MAX_REPAIR_ATTEMPTS,
      read: async (path) => {
        requested.push(path);
        return "secret";
      },
    });
    expect(requested).toEqual([]);
    expect(turns.at(-1)?.content).not.toContain("secret");
  });

  it("does not offer a delete patch as a file to re-emit", async () => {
    const requested: string[] = [];
    const turns = await buildRepairMessages({
      failure: failure({
        patchedFiles: [
          { path: "db/schema.ts", action: "update", content: "old" },
          { path: "src/old.ts", action: "delete" },
        ],
      }),
      attempt: 1,
      max: MAX_REPAIR_ATTEMPTS,
      read: async (path) => {
        requested.push(path);
        return path === "db/schema.ts" ? SCHEMA : "old content";
      },
    });
    const request = turns.at(-1)?.content ?? "";
    expect(requested).toEqual(["db/schema.ts"]);
    expect(request).toContain("### db/schema.ts");
    expect(request).not.toContain("### src/old.ts");
    expect(request).toContain("action delete still deletes");
  });

  it("skips files that do not exist yet (a create patch has no base)", async () => {
    const turns = await buildRepairMessages({
      failure: failure({ patchedFiles: [{ path: "src/new.ts", action: "create", content: "x" }] }),
      attempt: 1,
      max: MAX_REPAIR_ATTEMPTS,
      read,
    });
    expect(turns.at(-1)?.content).not.toContain("Current content");
  });
});
