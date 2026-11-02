import { describe, expect, it } from "vitest";

import { createTypeScriptSyntaxChecker } from "./node.ts";
import { checkPatchSyntax } from "./syntax-runner.ts";
import { create, makeContext } from "./testing/fixtures.ts";
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

describe("rule 1 through the node parser", () => {
  it("blocks a patch whose script does not parse", async () => {
    const patch = create("src/bad.ts", "export const value = (;\n");
    const findings = await checkPatchSyntax([patch], checker);
    const result = validatePatch([patch], {
      context: makeContext({ syntax: { status: "checked", findings } }),
    });
    expect(findings).toHaveLength(1);
    expect(result.errors.some((entry) => entry.rule === "ts-parse")).toBe(true);
  });

  it("passes a patch whose script parses", async () => {
    const patch = create("src/good.ts", "export const value: number = 1;\n");
    const findings = await checkPatchSyntax([patch], checker);
    const result = validatePatch([patch], {
      context: makeContext({ syntax: { status: "checked", findings } }),
    });
    expect(findings).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
