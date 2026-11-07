import { describe, expect, it } from "vitest";

import { analyzeProjectSources, createTypeScriptSyntaxChecker } from "./node.ts";
import { checkPatchSyntax } from "./syntax-runner.ts";
import { CONFIG, create, makeContext, SCHEMA } from "./testing/fixtures.ts";
import { validatePatch } from "./validator.ts";

const checker = createTypeScriptSyntaxChecker();

describe("createTypeScriptSyntaxChecker", () => {
  it("reports a syntactically invalid TypeScript file", async () => {
    const issues = await checker.check("src/bad.ts", "const value: number = ;\n");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.message.length).toBeGreaterThan(0);
    expect(issues[0]?.line).toBe(1);
  });

  it("accepts valid TypeScript and TSX", async () => {
    expect(await checker.check("src/good.ts", "export const value: number = 1;\n")).toEqual([]);
    expect(
      await checker.check("src/good.tsx", "export const A = () => <div>Don't</div>;\n"),
    ).toEqual([]);
  });
});

describe("analyzeProjectSources", () => {
  it("produces the analyzer facts the project context maps", () => {
    const analysis = analyzeProjectSources(
      new Map([
        ["facilis.config.ts", CONFIG],
        ["db/schema.ts", SCHEMA],
      ]),
    );
    expect(analysis.config.parsed).toBe(true);
    expect(analysis.config.permissions).toEqual(["todos:read", "todos:write"]);
    expect(analysis.tables.map((table) => table.name)).toEqual(["todos"]);
  });
});

describe("rule 1 through the node parser", () => {
  it("blocks a patch whose script does not parse", async () => {
    const patch = create("src/bad.ts", "export const value = (;\n");
    const findings = await checkPatchSyntax([patch], checker);
    const result = validatePatch([patch], {
      context: makeContext([patch], { syntax: { status: "checked", findings } }),
    });
    expect(findings).toHaveLength(1);
    expect(result.errors.some((entry) => entry.rule === "ts-parse")).toBe(true);
  });

  it("passes a patch whose script parses", async () => {
    const patch = create("src/good.ts", "export const value: number = 1;\n");
    const findings = await checkPatchSyntax([patch], checker);
    const result = validatePatch([patch], {
      context: makeContext([patch], { syntax: { status: "checked", findings } }),
    });
    expect(findings).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
